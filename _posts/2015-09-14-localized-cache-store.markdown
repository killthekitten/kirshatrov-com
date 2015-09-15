---
layout: post
title: Localized cache store in Rails
date: 2015-09-14 22:00:00 +0400
comments: true
published: true
---

Today I have got a [question in the Ruby on Rails Core mailing list](https://groups.google.com/forum/#!topic/rubyonrails-core/jRctpsQ-hO4):

> Tonight was the first time i faced one new bug on my website, when i saw one cached partial to be returned in another language than currently selected one. That  was i guess because that cache was generated when another locale was enabled.
Hence, shouldn't local be included by default into cache key?

*So, shouldn't we include the current locale into Rails cache key?*


As for the defaults, my guess is no. As DHH said, [only a very small minority of apps need localization](https://github.com/rails/rails/pull/21124#issuecomment-127995334), and I totally agree with him.

But to solve this particular case described in a mailing list, I've started looking for a way to specify a global cache key prefix.

First of all, `Rails.cache` API already has a simple way to pass a lambda with a namespace, but it isn't global:

{% highlight ruby %}
Rails.cache.read(:name, {
  namespace: ->() { I18n.locale }
})
{% endhighlight %}


First option was to add the namespace option to Rails config.
There were two reasons why I didn't stick with it:

1) `config.cache_store` accepts only store-specific settings and we would have to introduce a new option like `config.cache_key_namespace`

2) it's always better to find a solution without modifying Rails.

So, here is the better way that I found:

{% highlight ruby %}
Rails.application.configure do
  # ...
  def LocalizedCacheStore(klass)
    Class.new(klass) do
      def namespaced_key(key, options)
        "#{I18n.locale}:#{super}"
      end
    end
  end

  config.cache_store = LocalizedCacheStore(ActiveSupport::Cache::FileStore).new
end
{% endhighlight %}

I borrowed few ideas from the Functional (tm) approach: `LocalizedCacheStore` wraps existing cache class as a function, and you still have all control on your cache store if you need some options:

{% highlight ruby %}
config.cache_store = LocalizedCacheStore(ActiveSupport::Cache::RedisStore).new(
  'redis://localhost:6379/0/cache', { expires_in: 90.minutes })
{% endhighlight %}

As for me, it proves the great flexibility of Ruby and Rails: we didn't have to change any framework code, and `LocalizedCacheStore` logic is only 5 lines of code (two of them are `end`s).
