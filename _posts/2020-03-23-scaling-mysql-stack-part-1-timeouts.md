---
layout: post
title: "Scaling MySQL stack, ep. 1: Timeouts"
date: 2020-03-23
comments: true
published: true
---

I've spent a good part of last year collaborating with different people at work on the theme of scaling our MySQL stack to the next level. For background, like many other companies founded in the mid-2000s (Facebook, YouTube, GitHub, Basecamp), Shopify is a MySQL shop. We've invested a lot into our tooling to manage and scale MySQL, and lately, it's been time to invest in improving ways how applications interact with MySQL.

Accounting for all my learnings, I decided to commit not just for a single post about it, but to a **series of at least three posts about scaling MySQL stack.** As always, [follow me on Twitter](https://twitter.com/kirshatrov){:target="_blank"} to be the first to read them.

***

This post is the first in the series, and it will talk about **timeouts** and how to make them **fine-grained**.

Commonly, a query that's taking too long to run will eventually time out, and the developer would see an exception. The first thing to find there is whether that's a timeout on the **client** or on the **server** side.

Timeout on the client side means that the client gave up on waiting for the response from the server. It could indicate not only a slow query but also a server that went away without closing the socket, making the client to wait for too long. At least in Ruby's [mysql2](https://github.com/brianmario/mysql2){:target="_blank"} client, client timeout is tweaked through `read_timeout` option.

Timeout on the server always means that the query has run too long so MySQL server decided to terminate it.

There's multiple ways to set timeout on the server side:

* `SET GLOBAL MAX_EXECUTION_TIME=2000;` (available in MySQL >=5.7.7)

* Append a magic comment on all your queries, like `SELECT /*+ MAX_EXECUTION_TIME(1000) */ FROM products` (available in MySQL >=5.7.7)

* Use [pt-kill](https://www.percona.com/doc/percona-toolkit/LATEST/pt-kill.html){:target="_blank"}, a tool that constantly polls all connections and kills those that have queries running for longer than X (commonly used before MySQL 5.7)

**Timeout on the client should always be longer** than the timeout on the server - otherwise, your clients will never acknowledge server timing out and will always lose the connection and have to reconnect. With the right configuration, you should see clients timing out very rarely, and mostly due to network issues.

Now, imagine you have a good understanding of timeouts and how to configure them properly. How do you leverage that in your app?

## Cooking timeouts right

A great standard timeout could be a value around 5 seconds. Make it longer, and you're in risk of queries taking too much MySQL CPU time. That's the risk that we want to reduce from the capacity standpoint to allow for more throughout for the rest of the queries (see [Little's law](https://en.wikipedia.org/wiki/Little%27s_law){:target="_blank"}).

At the same time, your app is likely to have some reporting feature that requires running longer-than-average queries on the DB. Eventually, you'll have a slightly larger customer with more records in the DB that will take longer to fetch than the existing timeout allows. You want the client to get the most out of your app _now_, so you go and increase the default timeout.

Unless you do the right thing from the very beginning and offload analytical queries from the primary DB to a replica, or [another store](https://en.wikipedia.org/wiki/Online_analytical_processing){:target="_blank"} that is meant for that, you are very likely to end up with a query timeout configured to low double-digit numbers. While it's a pretty bad state to be in terms of resiliency and resource usage (imagine the DB slows down for all queries and every client would block and wait too long), it's a common thing that happened to many projects.

The best thing you can do now (beside making those features use faster queries) is **only to allow known slow things to be slow** and keep fast things fast. **That means that the code path that is running a known bad query can be allowed to take 10 seconds to run, but most other codepaths that do O(1) lookups should still have a pretty low timeout.** This helps with two things: **making regressions more noticeable** and making things **[fail fast](https://www.oreilly.com/library/view/release-it/9781680500264/f_0047.html){:target="_blank"} during incidents**.

Whitelisting harmful patterns and call sites to limit their spread is what we often do at Shopify, we even gave it a name ([read about shitlists](https://sirupsen.com/shitlists/){:target="_blank"}).

So, how do you achieve that with MySQL?

In the previous section, I've mentioned that you can annotate a query with a magic comment that gives MySQL Server a **hint** to limit its execution time:

```
SELECT /*+ MAX_EXECUTION_TIME(10000) */ FROM products
```

Note that `MAX_EXECUTION_TIME` takes time in milliseconds, so 10000 in my example is 10 seconds.

There's a lot more query hints that MySQL supports, [check out the list](https://mysqlserverteam.com/new-optimizer-hints-in-mysql/){:target="_blank"} if you're curious.

Even ActiveRecord 6.0 comes with support for hints in the query builder:

```
Product.optimizer_hints("MAX_EXECUTION_TIME(10000)").all
# SELECT /*+ MAX_EXECUTION_TIME(10000) */ `products`.* FROM `products`
```

This way, you can set the global `MAX_EXECUTION_TIME` to a lower value (I'd recommend <=5 seconds) and override it for specific queries that are known to be slow. This way, you will isolate parts of your project that need a larger timeout, while not having to increase the global timeout for the rest of the project.

This works great for a small to medium size codebase, but what if your app has hundreds or thousands of call sites that would need to have explicit about tweaking the timeout?

This has been the case for us, and we had to come up with something that wouldn't require us to study and touch every wrong query pattern in the codebase.

We settled on doing this on a per controller basis. Here's a quick example of how that could be done in Rails:

```ruby
class ApplicationController < ActionController::Base
  around_filter :set_context_max_execution

  private

  def set_context_max_execution
    uow_name = "#{self.class}##{params[:action]}"
    if (max_execution = max_execution_for(uow_name))
      begin
        Thread.current[:query_max_execution_ms] = max_execution
        yield
      ensure
        Thread.current[:query_max_execution_ms] = nil
      end
    else
      yield
    end
  end

  def max_execution_for(uow_name)
    # lookup the YAML table. Must return milliseconds
  end
end
```

I've skipped the ActiveJob part for wrapping the job with into a thread-local variable in the same way as with the controller, but you get the idea.

Now comes the corresponding bit to inject context-based `MAX_EXECUTION_TIME` into all queries:

```ruby
module ConnectionPatch
  def execute(sql, name = nil)
    sql = annotate_sql_with_max_execution(sql)
    super(sql, name)
  end

  private

  def annotate_sql_with_max_execution(sql)
    return sql unless sql.valid_encoding?

    if /MAX_EXECUTION_TIME\(\d+\)/.match?(sql)
      return sql
    end

    # The MySQL the parser [1] recognizes
    # optimizer hint comments after the initial keyword of
    # SELECT, UPDATE, INSERT, REPLACE, and DELETE statements.
    # This code appends the hint after the first SELECT.
    # Subqueries are not modified by this patch.
    # [1]: https://dev.mysql.com/doc/refman/5.7/en/optimizer-hints.html
    if sql.starts_with?("SELECT")
      sql = sql.sub("SELECT", "SELECT /*+ MAX_EXECUTION_TIME(#{max_execution_ms}) */")
    elsif sql.starts_with?("select")
      sql = sql.sub("select", "select /*+ MAX_EXECUTION_TIME(#{max_execution_ms}) */")
    end

    sql
  end

  def max_execution_ms
    if Thread.current[:query_max_execution_ms]
      Thread.current[:query_max_execution_ms]
    else
      5000 # default 5 seconds
    end
  end
end

ActiveRecord::ConnectionAdapters::Mysql2Adapter.prepend(ActiveRecordMaxExecution::ConnectionPatch)
```

Then, we went through logs and collected all entry points (for a Rails app, that's controllers and background jobs) that produce slow queries. We ended up having a YAML hash where the entry point is the key, and max query time we've seen in that entry point is the value.

```
$ less db/data/slow_query_shitlist.yml
---
UpdateAllProductsJob: 10000
AddressGeolocationJob: 6100
Dashboard::BarsController#show: 13800
Dashboard::CustomersController#index: 15400
...
```

We could now wrap all code within every entry point into `MAX_EXECUTION_TIME` for "known to be bad" areas while enforcing a lower default timeout for the rest of the app.

We could go further and figure a **dynamic default timeout** based on the business importance of the code: REST or GraphQL API is hit by computers where a longer timeout is tolerable, while something like payments is interactive and would benefit from failing fast without having to wait for too long.

## Conclusion

We often say "that thing timed out because it took too long", but it's essential to separate client timeouts from server timeouts. If configured right, you should never see clients to time out. That leaves us server timeouts to tackle.

We use to think that query timeout is configured globally, while the latest versions of MySQL allow setting that dynamically per query. You can use that to contain code paths that are known to be slow, and if your app is too big to wrap each spot explicitly, you can use the shitlist approach.

Using dynamic timeouts, you can enforce the best defaults on new code while keeping compatibility for features that required longer timeouts. Doing that will pontentially allow extra query throughput during overload and will limit the blast radius of disruptions.

In the next post of **Scaling MySQL stack series**, I'm going to write about the concept of **deadlines** and how they could be leveraged in a production app.

Other posts in the series: [Episode 2: Deadlines](/2020/04/06/scaling-mysql-stack-part-2-deadlines/) &bull; [Episode 3: Observability](/2020/04/16/scaling-mysql-stack-part-3-observability/) &bull; [Episode 4: Proxies](/2020/04/27/scaling-mysql-stack-part-4-proxy/)
