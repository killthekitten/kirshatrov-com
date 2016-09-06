---
layout: post
title: "When abstractions are wrong: ActionController::TestCase"
date: 2016-09-05
comments: true
published: true
---

Recently, I've been working on improving the quality of controller tests in Shopify core, with the primary goal of making them Rails 5-ready.

Spending days on this helped me to understand the higher-level problem of abstractions. I decided to write a post about it to share my thoughts and discuss it with the readers.

Imagine a controller test in Rails that asserts `create` endpoint of a JSON API:

{% highlight ruby %}
class PostsControllerTest < ActionController::TestCase
  test "should create post" do
    post :create, params: { post: { title: "title" } }, format: :json
    assert_response :created
  end
end
{% endhighlight %}

Counting that we specified `format: :json`, how do you think the request parameters will be encoded? As JSON or as form data? If we hook into controller with [byebug](https://github.com/deivid-rodriguez/byebug), we'll see the answer:

{% highlight text %}
(byebug) request.format.to_s
"application/json"
(byebug) request.body.read
"post%5Btitle%5D=title"
{% endhighlight %}

As you see, it's the form data. It didn't emulate JSON API. For some reason `format: :json` does not tell Rails to make request with JSON data. In fact, all it does is that it emulates `.json` at the end of URL.

To actually emulate JSON API request, we can use this snippet:

{% highlight ruby %}
test "should create post" do
  @request.headers['CONTENT_TYPE'] = 'application/json'
  post :create, params: { post: { title: "title" } }, format: :json
  assert_response :created
end
{% endhighlight %}

And verifying it with byebug, we can see it's the real JSON:

{% highlight text %}
(byebug) request.format.to_s
"application/json"
(byebug) request.body.read
"{\"post\":{\"title\":\"title\"}}"
{% endhighlight %}

The same applies to XML requests:

{% highlight ruby %}
test "should create post" do
  # magic headers to enable Rails to encode request params to XML
  @request.headers['CONTENT_TYPE'] = "application/xml"
  post :create, params: { post: { title: "title" } }, format: :xml
  assert_response :created
end
{% endhighlight %}

{% highlight text %}
(byebug) request.format.to_s
"application/xml"
(byebug) request.body.read
"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<hash>\n  <post>\n    <title>title</title>\n  </post>\n</hash>\n"
{% endhighlight %}

How comes that `format: :json` or `format: :xml` has *no effect on request body*, and setting `@request.headers['CONTENT_TYPE']` outside of request method has?

Here are the [Rails sources](https://github.com/rails/rails/blob/029cbb35352ed79805da1b3a089e724b05bd2a80/actionpack/lib/action_controller/test_case.rb#L100-L113) responsible for request encoding part:

{% highlight ruby %}
case content_mime_type.to_sym
when nil
  raise "Unknown Content-Type: #{content_type}"
when :json
  data = ActiveSupport::JSON.encode(non_path_parameters)
when :xml
  data = non_path_parameters.to_xml
when :url_encoded_form
  data = non_path_parameters.to_query
else
  @custom_param_parsers[content_mime_type.symbol] = ->(_) { non_path_parameters }
  data = non_path_parameters.to_query
end
{% endhighlight %}

Based on content-type, Rails tries to convert request body to an appropriate format, like to `xml` when the content-type is `application/xml`.

# Lessons learned

{% highlight ruby %}
# to submit form data
post :create, params: { post: { title: "title" } }

# to send XML document
@request.headers['CONTENT_TYPE'] = "application/xml"
post :create, params: { post: { title: "title" } }

# to send JSON document
@request.headers['CONTENT_TYPE'] = "application/json"
post :create, params: { post: { title: "title" } }
{% endhighlight %}

Look at three ways to hit Rails controller with a request. All of them look similar, but the requests are totally different: in first case it's form data, in second case it's XML document and in third it's JSON encoded string.

In my opinion, this is not very straight forward and the **choice of request format should not be hidden from the developer**. As a result, today developer just writes `post :create, post: { title: "my post"}` and doesn't even know which format the request got.

Rails tries to put selection of request data under the hood, but in fact this logic becomes hidden. It would be better to educate developers about request types and make them write more explicit code.

Working with platforms with less magic like Clojure or Go, I would have to explicitly declare the request body:

{% highlight go %}
url := "http://webscale.io"
json := []byte(`{"title":"Rails does not scale."}`)
req, err := http.NewRequest("POST", url, bytes.NewBuffer(json))
req.Header.Set("Content-Type", "application/json")

client := &http.Client{}
resp, err := client.Do(req)
if err != nil {
    panic(err)
}
defer resp.Body.Close()

fmt.Println("response Status:", resp.Status)
{% endhighlight %}

This looks a bit too explicit after Rails, but you see the point: developer has to explicitly set request body to JSON string and the content-type. No magic of encoding request body under the hood.

## Conclusion

For me, it has been a lesson about the case when hiding things into abstraction may be not the best way to go.

**Good news**: the behavior I described applies only to `ActionController::TestCase`. While it's still used in most of Rails applications, [`ActionController::TestCase` is deprecated in Rails 5](http://blog.bigbinary.com/2016/04/19/changes-to-test-controllers-in-rails-5.html). New apps should always use `ActionDispatch::IntegrationTest` for controller testing. In contrast, it doesn't have any hidden logic for automatically encoding request body and you'd have to do that yourself:

{% highlight ruby %}
class PostsControllerTest < ActionDispatch::IntegrationTest
  test "should create post" do
    json_body = { post: { title: "title" } }.to_json

    # posts_path(format: :json) is required to hit "/posts.json"
    post posts_path(format: :json), params: json_body
    assert_response :created
  end
end
{% endhighlight %}

**Good news v2**: `ActionController::TestCase` [now gets "as" option](https://github.com/rails/rails/pull/26212), which explicitly tells the request format. You don't have to operate with `@request.headers['CONTENT_TYPE']` anymore.
