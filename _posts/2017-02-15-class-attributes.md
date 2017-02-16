---
layout: post
title: Class attributes and ActiveSupport
date: 2017-02-15
comments: true
published: true
---

It's not uncommon case to provide a class-level accessors for some kind of configuration.
For instance, ActiveRecord has multiple class-level settings:

```ruby
ActiveRecord::Base.inheritance_column = "type"
ActiveRecord::Base.schema_migrations_table_name = "schema_migrations"
```

Some of them are model-level:

```ruby
class Post < ActiveRecord::Base;end

Post.ignored_columns = ["legacy_column"]
```

How do you implement them?
You can start with the vanilla Ruby implementation:

```ruby
module Configurable
  def setting
    @setting
  end

  def setting=(value)
    @setting = value
  end
end

class Post
  extend Configurable
  self.setting = "default"
end

Post.setting # => "default"
```

However, the default value won't be available in the subclass:

```ruby
class Article < Post;end

Article.setting # => nil
```

You can fix it by changing the `setting` accessor:

```ruby
module Configurable
  def setting
    if defined?(@setting)
      @setting
    else
      superclass.setting
    end
  end
end
```

Now the `setting` value of parent class will also be accessible in the child class.
Unfortunatelly, this snippet doesn't scale if you are going to have a dozen of class accessors.

There comes ActiveSupport with `mattr_accessor` and `class_attribute`.

`mattr_accessor` defines both class and instance accessors for class attributes [(docs)](http://api.rubyonrails.org/classes/Module.html#method-i-mattr_accessor)

```ruby
require 'active_support/core_ext/module/attribute_accessors'

class Person
  mattr_accessor :hair_colors
end

HairColors.hair_colors = [:brown, :black, :blonde, :red]
HairColors.hair_colors # => [:brown, :black, :blonde, :red]
Person.new.hair_colors # => [:brown, :black, :blonde, :red]
```

Keep in mind that **if a subclass changes the value then that would also change the value for parent class.**
Similarly if parent class changes the value then that would change the value of subclasses too.

```ruby
class Male < Person;end

Male.hair_colors = [:blue]
Person.hair_colors # => [:blue]
```

Usually this is not the desired behaviour and you'd want subclasses not to change the parent class values.
There comes `class_attribute` [(docs)](http://api.rubyonrails.org/classes/Class.html#method-i-class_attribute).

It declares a class-level attribute whose value is inheritable by subclasses.
Subclasses can change their own value and it will not impact parent class.

```ruby
require 'active_support/core_ext/class/attribute'

class Base
  class_attribute :setting
end

class Subclass < Base;end

Base.setting = true
Subclass.setting            # => true
Subclass.setting = false
Subclass.setting            # => false
Base.setting                # => true
```

When I've been reading `class_attribute` implementation it surprised me how elegant the writer method works.
You'd probably expect that it stores the value in the instance variable, like we did in the vanilla Ruby solution above.

The code from [`active_support/core_ext/class/attribute.rb`](https://github.com/rails/rails/blob/94ca3e0a571dba0fe41ca18d61634c5f3aa11209/activesupport/lib/active_support/core_ext/class/attribute.rb#L87-L91):

```ruby
def class_attribute(*attrs)
  # ...
  attrs.each do |name|
    # ...
    define_singleton_method("#{name}=") do |val|
      singleton_class.class_eval do
        define_method(name) { val }
      end
    end
  end
end
```

It took me a moment to understand *why* writer method does `class_eval` and `define_method`.
Then I realized that it simply declares a reader method that returns the new value.

Normally this would hurt the performance because adding a method [resets the method cache](tmm1.net/ruby21-method-cache/),
but in case of a class-level attributes you only change it once or twice on the application start.
In this case it makes more sense to declare a method dynamically rather than use instance variables.

***

I really liked this trick when I found it, and it's the main reason why I wrote this post.
Even if you avoid using ActiveSupport in smaller non-Rails projects, now you know
multiple options of implementing class-level attributes in Ruby.
