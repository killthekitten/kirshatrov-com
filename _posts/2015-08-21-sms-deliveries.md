---
title:  "A Draft Post"
description: Work in progress
date: 2015-08-19 19:07:00 +0400
---

What if the customer wants the feature to send SMS messages from the Rails app?
In this post we will start with the very simple implementation, try to cover it with tests and then totally rewrite the code to demonstrate the Repository (?) pattern.

[Twilio](https://www.twilio.com/) is one of the most popular providers for sending all kinds of notifications, including SMS. This is the reason we will use Twilio in our sample code.
Let’s start with the _very_ simple AJAX action:

{% highlight ruby %}
class MessagesController < ApplicationController
  # ...
  def create
    if params[:body].present?
      client = Twilio::REST::Client.new(ENV['TWILIO_ACCOUNT_SID'], ENV['TWILIO_AUTH_TOKEN'])
      client.messages.create(
        from: current_user.phone_number,
        to: manager.phone_number,
        body: params[:body]
      )
      render nothing: true
    else
      render status: :unprocessable_entity
    end
  end
end
{% endhighlight %}

This AJAX action is called from Javascript, so we don't have to worry about views.
You can probably see what's bad in this code, but let's cover it with tests first to be ready for refactoring.

{% highlight ruby %}
describe MessagesController do
  context "with valid body" do
    before do
      @twilio_stub = stub_request(:post, "https://username:password@api.twilio.com/2010-04-01/Accounts/1/Messages.json").with(:body => {"Body"=> "hello world", "From"=>"some_number", "To"=>"another_number"}).to_return(body: {sid: "1", from: "Value returned by API", to: "Value returned by API", body: "Value returned by API"}.to_json)
    end
    
    it "sends SMS" do
      post :create, body: "hello world"

      expect(@twilio_stub).to have_been_requested
    end
  end

  context "with blank body" do
    post :create, body: ""

    expect(response.status).to eq 422
  end
end

{% endhighlight %}

NB: The `stub_request` methods comes from the [webmock](https://github.com/bblimke/webmock) gem.
Since it is a bad practice to make _real_ HTTP requests to the live APIs from the test environment, webmock is often used to stub HTTP requests from the app and set HTTP request expectations.

Omitting that the API call is made synchronously from the controller, what's wrong here?
The implementation of SMS sending code is less than 10 lines of code, but what's the trade-off?

Let's imagine that we have to send SMS not only from the controller, but also when the user runs out of credit.


{% highlight ruby %}
class User < ActiveRecord::Base
  # ...
  
  # this method is triggered when the user balance becomes zero
  def run_out_of_money
    # notify with email
    UserMailer.run_out_of_money(id).deliver

    # notify with SMS
    client = Twilio::REST::Client.new(ENV['TWILIO_ACCOUNT_SID'], ENV['TWILIO_AUTH_TOKEN'])
    client.messages.create(
      from: "MYAPP",
      to: phone_number,
      body: "Dear #{name}, your account balance is zero."
    )
  end
end

{% endhighlight %}

And the spec:


{% highlight ruby %}
describe User do
  describe "#run_out_of_money" do
    pending "sends email"

    before do
      @twilio_stub = stub_request(:post, "https://username:password@api.twilio.com/2010-04-01/Accounts/1/Messages.json").with(:body => {"Body"=> "Dear Kir, your balance is zero.", "From"=>"some_number", "To"=>"another_number"}).to_return(body: {sid: "1", from: "Value returned by API", to: "Value returned by API", body: "Value returned by API"}.to_json)
    end

    it "sends SMS" do
      user = User.new(name: "Kir")
      user.run_out_of_money

      expect(@twilio_stub).to have_been_requested
    end
  end
end

{% endhighlight %}

The first point that I really don't like here, is that in every spec that calls Twilio, we have to stub the request with

What if we write a spec for some method that triggers `run_out_of_money`? It means that this spec also should have the `stub_request` call for Twilio API. Is that convinient?

Let's look how the ActionMailer testing works.

{% highlight ruby %}
# config/environments/test.rb
Rails.application.configure do
  # [...]
  config.action_mailer.delivery_method = :test
end
{% endhighlight %}

Look at `action_mailer.delivery_method`. It accepts:

* `:smtp` — send emails by SMTP, used in production
* `:test` — push all deliveries to `ActionMailer::Base.deliveries`

With this approach, you can access `ActionMailer::Base.deliveries.last` in the test environment and check if the sent email was correct:

{% highlight ruby %}
delivery = ActionMailer::Base.deliveries.last
expect(delivery.subject).to match /Welcome/
expect(delivery.to).to eq "shatrov@me.com"
expect(delivery.raw_body).to match /Welcome to the project/
{% endhighlight %}

Why don't we use the same approach for SMS deliveries?
Our goal is have an ability to write a spec like this:

{% highlight ruby %}
it "sends SMS" do
  user = User.new(name: "Kir")
  user.run_out_of_money

  delivery = SmsSender.backend.deliveries.last
  expect(delivery.body).to eq "Hey Kir, welcome!"
end
{% endhighlight %}
