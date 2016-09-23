---
layout: post
title: "Dynamic breaking points in Ruby"
date: 2016-09-23
comments: true
published: true
---

Debugging a large codebase can sometimes be a pain, especially if you're new to it and
you don't know about all the classes and relations in the system.

In this post I'd like to share a cool (IMO) way to debug not well-known codebase using
dynamically created breakpoints. *NB:* yes, Ruby is so dynamic that you can create breakpoints on the go.

Assuming that you use [byebug](https://github.com/deivid-rodriguez/byebug) or [pry](http://pryrepl.org/),
imagine that you've put a breaking point:

{% highlight ruby %}
class PaymentValidator
  attr_accessor :credit_card

  def initialize(checkout, attributes = {})
    self.credit_card = checkout.create_credit_card
    binding.pry
  end
end
{% endhighlight %}

![screen shot 2016-09-22 at 21 02 30](https://cloud.githubusercontent.com/assets/522155/18772286/a0bfca58-8113-11e6-88da-b6f66fe09613.png)

Inside the breaking point, you only know that there is a `credit_card` object with `errors` method
coming from [ActiveModel::Errors](http://api.rubyonrails.org/classes/ActiveModel/Errors.html).
You also expect that some other objects will be calling `errors.add`, but you don't know who
and how will be doing it.

Here is what you can insert being in the breaking point:

{% highlight ruby %}
mod = Module.new do
  def add(*args)
    binding.pry
    super
  end
end
credit_card.errors.extend(mod)
{% endhighlight %}

This snipped will inject into `add` method from `credit_card.errors` and start debugging when someone
calls that method. Tricky, eh?

In my case, this dynamic breaking point helped me to find which objects have been adding errors on `credit_card` object.

As an alternative, I could probably insert a breaking point into  the `ActiveModel::Errors#add` method,
but that would trigger too many breaking points that I'm not interested in, because `ActiveModel::Errors#add`
is used in other places of the same system.

Happy debugging!
