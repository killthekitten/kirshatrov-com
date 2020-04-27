---
layout: post
title: "Scaling MySQL stack, ep. 4: Proxies"
date: 2020-04-27
comments: true
published: true
---

I've spent a good part of last year collaborating with different people at work on the theme of scaling our MySQL stack to the next level. For background, like many other companies founded in the mid-2000s (Facebook, YouTube, GitHub, Basecamp), Shopify is a MySQL shop. We've invested a lot into our tooling to manage and scale MySQL, and lately, it's been time to invest in improving ways how applications interact with MySQL.

Accounting for all my learnings, I decided to commit not just for a single post about it, but to a **series of at least three posts about scaling MySQL stack.** As always, [follow me on Twitter](https://twitter.com/kirshatrov){:target="_blank"} to be the first to read them.

---

The [previous post](/2020/04/16/scaling-mysql-stack-part-3-observability/) in the series talked about observability of live SQL queries and annotating those queries with useful metadata.

In today's post, we will learn about scaleing out DB connections and how proxies help with that.

Imagine that your service has been growing in terms of the traffic, so is the number of application servers that is needed to serve that traffic. You may use Heroku and bump the number of dynos, or run it in Kubernetes and increase the number of web server replicas, or add more bare metal servers to your data center.

Regardless of your deployment choice, **more application servers means more connections** to all downstream resources that your app may be using: Memcache, Redis, MongoDB, MySQL etc.

Why does the number of connections matter? Just like the number of queries per second or IOPS, number of open connections is a **key metric that causes load on the database**. For instance, Oracle's MySQL edition keeps a system thread per connection &ndash; which means that for 1000 open connections to MySQL, there will be 1000 Linux threads, all saturating the CPU (which in the best case would have 64 or 128 cores to handle that 1k of threads).

This gets even worse with horizontal sharding: each application server may want to keep a connection to each shard (in case a request for a data from that shard comes in), which makes the number of connections to grow even higher.

## Proxies come to the rescue

To address this problem and reduce the number of open connections to the database, it's common to introduce a proxy in between the app and the database that would **multiplex** connections.

<img src="/assets/post-images/2020-multiplexing-1.svg" alt="Multiplexing" class="bordered" style="margin: 0 auto;" />

On the diagram above clients are connecting directly to the database.

The purpose of connection multiplexing is to convert a large number of short connections into a few warmed up connections needing more throughput. Here's how it looks like with a proxy:

<img src="/assets/post-images/2020-multiplexing-2.svg" alt="Multiplexing" class="bordered" style="margin: 0 auto;" />

As you can see, having a proxy in the middle allows us to reduce the number of actual connections, - and moreover, terminate things that don't necessarily need to go to MySQL Server. For instance, it could be `mysql_ping` that many ORMs like to send to verify that the connection is alive. I've seen significant reductions of QPS on MySQL Server just from terminating `mysql_ping` early.

**SaaS applications** often keep a large number of database connections open to ensure quick user response times, although only a fraction of these open connections may get actively used at a given moment. These open but idle connections still consume database memory and compute resources. Instead of over-provisioning your database to support mostly idling connections, you can leverage the proxy to hold idling connections from your application while only establishing database connections as required to optimally serve active requests.

For MySQL, that multiplexing proxy is [ProxySQL](https://github.com/sysown/proxysql/){:target="_blank"}. For PostgreSQL, it's the [pgbouncer](https://github.com/pgbouncer/pgbouncer){:target="_blank"}. Having been exposed quite a lot to ProxySQL at work, I'd like to highlight some cool features of it.

## Things to do with ProxySQL

By default, all ProxySQL brings is multiplexing connections. I've seen 20x reductions on DB load after introducing ProxySQL, so just multiplexing is already huge. However, there are a lot more things you can do with it:

- Instead of making your application to have the `primary` and `replica` connections, keep a single connection to ProxySQL and configure ProxySQL query rules to send the connection to either the primary or a replica based on a query annotation like `/* readonly=true|false */`. This will help to avoid connection switching in the app and to save the number of outgoing connections from the client.

- Implement [load shedding](https://landing.google.com/sre/sre-book/chapters/addressing-cascading-failures/#xref_cascading-failure_load-shed-graceful-degredation){:target="_blank"} by having a dynamic ProxySQL query rule that would be on/off depending on the DB load. How to determine what queries are OK to reject? Again, with [annotations](/2020/04/16/scaling-mysql-stack-part-3-observability/){:target="_blank"} &ndash; for instance, anything that matches `/* controller=SitemapController */` is likely the low priority traffic.

- Identify expensive queries using the stats table in ProxySQL and pin those queries to a replica database without having to make changes to the app. This one is dangerous because it may increase the debt in the app, but super handy during incidents.

- Perform a zero-downtime HA failovers between MySQL instances since all your clients are connected to a proxy and you can point them to differnet backends.

Have you been using ProxySQL or another proxy in your project? Let me know!

Further reading about multiplexing:

- [Connection pooling on PostgreSQL](https://devcenter.heroku.com/articles/postgres-connection-pooling){:target="_blank"}

- [Multiplexing with ProxySQL](https://www.percona.com/blog/2019/09/27/multiplexing-mux-in-proxysql/){:target="_blank"}

- [ProxySQL at Shopify](https://drive.google.com/open?id=19H2PiHGvkBxtbiCrzU6kc7kmF5geCGOY){:target="_blank"}

- [Database proxy as the new AWS offer](https://aws.amazon.com/rds/proxy/){:target="_blank"}

---

**When** is the right moment to introduce a proxy like ProxySQL or PgBouncer? Watch for the number of open connections on your database and its growth. If you see a surge in traffic that pushes the number of open connections above 1k, and the DB is struggling on the CPU, having a proxy should help.

What would you like me to write about in the next post of the **Scaling MySQL stack series**? Please let me know by replying in comments or by sending me a tweet.
