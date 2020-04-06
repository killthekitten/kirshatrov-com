---
layout: post
title: "Scaling MySQL stack, ep. 2: Deadlines"
date: 2020-04-06
comments: true
published: true
---

I've spent a good part of last year collaborating with different people at work on the theme of scaling our MySQL stack to the next level. For background, like many other companies founded in the mid-2000s (Facebook, YouTube, GitHub, Basecamp), Shopify is a MySQL shop. We've invested a lot into our tooling to manage and scale MySQL, and lately, it's been time to invest in improving ways how applications interact with MySQL.

Accounting for all my learnings, I decided to commit not just for a single post about it, but to a **series of at least three posts about scaling MySQL stack.** As always, [follow me on Twitter](https://twitter.com/kirshatrov){:target="_blank"} to be the first to read them.

---

The [previous post](/2020/03/23/scaling-mysql-stack-part-1-timeouts/) in the series talked about timeouts and how to configure them elastically in a large app.

In this post, we’ll cover something not too far from timeouts: the **deadline** concept that can help to enforce boundaries around how slow an entrypoint path can be.

Imagine that you’ve tuned query timeouts well, and no query takes longer than 3 seconds. However, it’s still possible that some poorly designed controller action would produce 20 slow queries to the DB, allowing the max total response time of 60 seconds. That’s a very long time for a page to load, and it’s unlikely that the human on the otherwise will wait for that long. Most likely, all of that data would be queried and rendered and then served into nowhere because the client gave up on waiting for it and closed the socket.

To save the resources that are used to serve slow paths and to free the capacity (imagine that all the internet starts hitting that slow path), it’s common to enforce a global request timeout on the app itself.

In the Rails world, [rack-timeout](https://github.com/sharpstone/rack-timeout){:target="_blank"} is a common solution to enforce that, although it has [major known issues](https://github.com/sharpstone/rack-timeout/blob/master/doc/risks.md){:target="_blank"} with cleaning up resources that were used at the time of the interrupt.

If we look around for similar concepts in the world of RPC (Remote Procedure Call), there's a whole **Deadline** concept [there](https://grpc.io/blog/deadlines/){:target="_blank"}, where each call gets annotated with a deadline announcing when the operation should either complete or abort. And if you’ve ever written code in Go, you remember the `context` feature that allows setting `WithDeadline` on the current context.

If at the beginning of the request we set the deadline to a timestamp in 30 seconds from now, and make every dependency like the MySQL adapter respect that, we could solve the problem with request timeouts.

<img src="/assets/post-images/2020-deadlines.svg" alt="Request deadlines" class="bordered" style="margin: 0 auto;" />

## Implementation details

The most common long-taking operation in web apps is SQL queries.

We will use Rails' ActiveRecord as an example of the ORM, but this concept is applicable to any stack.

The idea of the deadline approach is to hook into the entrypoint of _yet another slow operation_, and fail with an exception there if the deadline has exceeded. For ActiveRecord, that entrypoint is the `execute` method.

```ruby
module ActiveRecord
  class DeadlineExceededError < ActiveRecord::ActiveRecordError
    def initialize
      super("The query was cancelled because the request or a job timeout has been hit")
    end
  end

  module DeadlinePatch
    def execute(sql, name = nil)
      if Deadline.current && Deadline.current.exceeded?
        raise DeadlineExceededError.new
      end
      super
    end
  end
end

ActiveRecord::ConnectionAdapters::Mysql2Adapter.prepend(ActiveRecord::DeadlinePatch)
```

Now, let's set the deadline in the middleware to make it initialized on every new request:

```ruby
class DeadlineMiddleware
  DEADLINE_SECONDS = 25

  def initialize(app)
    @app = app
  end

  def call(env)
    deadline = Deadline.new(DEADLINE_SECONDS)
    env['deadline'] = deadline
    Deadline.current = deadline
    @app.call(env)
  ensure
    env.delete('deadline')
    Deadline.current = nil
  end
end
```

I've omitted the implementation of the `Deadline` class, which is a plain Ruby object that acts as a store for the timestamp.

The API like `Deadline.current.exceeded?` allows developers to shape their code around it, if they are implementing any long-running flows.

If you've got support for dynamic `MAX_EXECUTION_TIME` from [previous post](/2020/03/23/scaling-mysql-stack-part-1-timeouts/), you could hook into there and make sure that `MAX_EXECUTION_TIME` on any query is no longer than the time left in the deadline. `Deadline.current.time_left_seconds` returns that time.

Someone might ask, "what about other remote calls, like Redis or Memcache, or HTTP clients? Unlike slow MySQL queries, both Redis and Memcache are supposed to complete within milliseconds. And for HTTP clients, it's about doing the same as we did with MySQL adapter.

It's also a lot nicer internally and *much* more reliable for MySQL to clean up due to a `MAX_EXECUTION_TIME` timeout than to detect the broken connection and clean up after that.

---

This is not a silver bullet -- to make deadlines cover 100% of cases, you'll need to verify that all network calls in your app respect the deadline. Thankfully, for most web apps, it's the MySQL adapter and possibly HTTP clients to external APIs.

We’ve had deadlines enabled in production at Shopify for months now, and it's been excellent at helping to clean up and save resources on slow code paths. And I’d love to contribute the Deadlines work in **Ruby on Rails upstream** - hit me up if you want to help me to do that!

In the next post of **Scaling MySQL stack series**, I'm going to write about adding **observability** into all SQL queries, which especially comes useful for multi-tenant apps.
