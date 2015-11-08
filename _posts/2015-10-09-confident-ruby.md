---
layout: post
title: Confident Ruby by Avdi Grim
date: 2015-10-09 12:00:00 +0400
comments: true
published: true
---

<img src="/assets/post-images/confident_ruby.png" alt="Confident Ruby book" style="margin: 0 auto" class="bordered" />

Recently I have read a wonderful book by Avdi Grim about Ruby called <a href="http://www.confidentruby.com/">*Confident Ruby*</a>.

The book by itself is a collection of useful patterns, grouped by three topics: Collecting Input, Delivering Results and Handling Failure.

All these topics are highly recommended for all of you, even in case you are using Ruby for four years like I am. Avdi has a unique talent to illustrate patterns with perfectly matching code examples and abstractions. On the next day after you read the book, you will see how these patterns make your life better applied to the real life codebase.

There is only one piece in the book about the Null Object pattern that I would personally disagree:

{% highlight ruby %}
class NullObject < BasicObject
  def method_missing(*)
  end

  def respond_to_missing?(name)
    true
  end

  def nil?
    true
  end

  def !
    true
  end
end
{% endhighlight %}

[Null Object is quite a powerful pattern](https://robots.thoughtbot.com/rails-refactoring-example-introduce-null-object) that is in my opinion underestimated in Ruby and Rails worlds. But taking this example, I imagine how some junior developer copies the class, puts it into `lib/` of Rails projects and uses it everywhere in the project, which would make it a hell to debug issues.

Instead of using `NullObject` class globally, it may be a better idea to scope it to the particular library or API.

<hr/>

Thank you, Avdi! I wish I would read the book in 2013 when it was published because I could start using all these patterns to write the better code even earlier.
