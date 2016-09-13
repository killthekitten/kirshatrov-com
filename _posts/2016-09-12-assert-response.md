---
layout: post
title: "Improving Rails test helpers"
date: 2016-09-12
comments: true
published: true
---

A great productivity comes from the small things. When making sure that the app works
fine on the new version of Rails, I had to fix failures like this one many many times:

{% highlight ruby %}
PostsControllerTest#test_whatever
    Expected response to be a <200: ok>, but was a <422: Unprocessable Entity>.
Expected: 200
  Actual: 422
{% endhighlight %}

The test was usually fairly easy and it looked like this:

{% highlight ruby %}
class PostsControllerTest < ActionDispatch::Integration
  def test_whatever
    post :create, params: { post: { title: "title" } }, format: :json, as: :json
    assert_response :ok
  end
end
{% endhighlight %}

Every time I wanted to look inside, I had to insert a debugger (pry)
before the `assert_response` line and check what kind of errors are present the response body.

I thought: what can I do to make it easier? And I came up with this patch:

{% highlight ruby %}
module BetterAssertResponse
  def assert_response(*args)
    super
  rescue Minitest::Assertion => e
    if response.body.size < 200
      better_message = "#{e.message}\nResponse body: #{response.body}"
      raise Minitest::Assertion, better_message
    else
      raise
    end
  end
end
ActionDispatch::IntegrationTest.prepend(BetterAssertResponse)
{% endhighlight %}

Can you guess how it works?

*Before:*

{% highlight ruby %}
PostsControllerTest#test_whatever
    Expected response to be a <200: ok>, but was a <422: Unprocessable Entity>.
Expected: 200
  Actual: 422
{% endhighlight %}

*After:*

{% highlight ruby %}
PostsControllerTest#test_whatever
    Expected response to be a <200: ok>, but was a <422: Unprocessable Entity>.
Expected: 200
  Actual: 422
Response body: {"errors":["Invalid settings object for section '1'"]}
{% endhighlight %}

This trick saves me and other developers a few seconds every time we need to fix a failing test.
Counting the number of failing tests we had after upgrading Rails (> 1000), this potentually saves hours of work.

Good news: I've submitted [a patch to Rails](https://github.com/rails/rails/pull/26477) to bring this upstream.

You can do the same trick with `ActionController::TestCase` in your app. Unfortunatelly, we can't bring it into Rails because [ActionController testing has been deprecated](http://blog.bigbinary.com/2016/04/19/changes-to-test-controllers-in-rails-5.html).
