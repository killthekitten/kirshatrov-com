---
layout: post
title: "Scaling MySQL stack, ep. 3: Observability"
date: 2020-04-16
comments: true
published: true
---

I've spent a good part of last year collaborating with different people at work on the theme of scaling our MySQL stack to the next level. For background, like many other companies founded in the mid-2000s (Facebook, YouTube, GitHub, Basecamp), Shopify is a MySQL shop. We've invested a lot into our tooling to manage and scale MySQL, and lately, it's been time to invest in improving ways how applications interact with MySQL.

Accounting for all my learnings, I decided to commit not just for a single post about it, but to a **series of at least three posts about scaling MySQL stack.** As always, [follow me on Twitter](https://twitter.com/kirshatrov){:target="_blank"} to be the first to read them.

---

The [previous post](/2020/04/06/scaling-mysql-stack-part-2-deadlines/) in the series talked about the concept of Deadlines and how to introduce them to a mature codebase.

In today's post, we will talk about observability of live queries to the database.

Imagine that your app is online and it's receiving some traffic. The database is slightly under pressure and you want to investigate what part of the code is giving it the most stress.

Before leveraging tools like [New Relic](https://newrelic.com/){:target="_blank"} or [SolarWinds DPM](https://www.vividcortex.com/){:target="_blank"} (formerly known as VividCortex), you can query the `information_schema.processlist` meta table on the MySQL Server and see what queries are flowing:

```
> SELECT id, user, info_binary FROM information_schema.processlist;
+----+------+------------------------------------------------------------------+
| id | user | info_binary                                                      |
+----+------+------------------------------------------------------------------+
| 75 | app | SELECT c FROM users WHERE id=7111                              |
| 74 | app | SELECT c FROM users WHERE id=4275                              |
| 73 | app | SELECT c FROM users WHERE id=5014                              |
| 71 | app | SELECT c FROM users WHERE id=5038                              |
| 70 | app | SELECT c FROM users WHERE id=4729                              |
| 69 | app | SELECT c FROM users WHERE id=6761                              |
| 67 | app | SELECT c FROM users WHERE id=4983                              |
| 68 | app | SELECT c FROM users WHERE id=4982                              |
| 66 | app | SELECT c FROM users WHERE id=4977                                                         |
| 12 | root | SELECT id, user, info_binary FROM information_schema.processlist |
+----+------+------------------------------------------------------------------+
```

This data comes very usefully to find out unusually heavy queries that take too much DB capacity. You might get lucky, and when seeing the query, recognize the code path that’s making that query.

Unless you have a solid tracing infrastructure (for instance with [Datadog APM](https://www.datadoghq.com/apm/){:target="_blank"}), it can be hard to determine what code path triggers a common query like `SELECT * FROM users WHERE id=?`.

It would be great if we could append some kind of metadata to each query about the codepath where it's executing from, to make the processlist even more useful.

Luckily, SQL allows arbitrary comments inside queries, and processlist preserves them.

If instead of executing `SELECT * FROM users WHERE id=?` we could make the app execute something like `SELECT * FROM users WHERE id=? /* controller:users,action:show,method:find_user,api_client_id:42 */`, it would be much easier to navigate and identify where the load comes from.

This is not a novel idea - in fact, there's existing libraries that can do that automatically in your app. For the Rails ecosystem, that library is [Marginalia](https://github.com/basecamp/marginalia){:target="_blank"}. All you need is to plug it into the app, and every query will come annotated with their origin:

```
SELECT `accounts`.* FROM `accounts`
WHERE `accounts`.`queenbee_id` = 1234567890
LIMIT 1
/*application:BCX,controller:project_imports,action:show*/
```

Plugging a library like Marginalia makes the MySQL processlist 10x more informative and makes it so much easier to identify where bottlenecks come from.

This comes especially useful for **multi-tenant applications** where you can end up with some tenants being more noisy than others. Extending those SQL annotation with a field like `tenant_id` or `account_id` will allow you to see what tenant is creating the most load.

You can think of all sorts of automation for this: imagine running a script in a loop that takes a peek at processlist, groups queries by `tenant_id` and makes a live dashboard with top tenants by resource usage.

---

Observability is a hot topic in 2020 and there's many SaaS services (Datadog, SolarWinds DPM, NewRelic etc) that you can connect with your production stack and get insights about what's going on.

In addition to that, the trick with query annotations that I described lets you add observability within your stack and help to build your own automation around monitoring where the load comes from, and what customer/tenant is causing that load.

In the next post in the series, we will talk about **SQL proxies** and how they can buy you a 100x performance on the same hardware.

Other posts in the series: [Episode 1: Timeouts](/2020/04/06/scaling-mysql-stack-part-1-timeouts/) &bull; [Episode 2: Deadlines](/2020/04/06/scaling-mysql-stack-part-2-deadlines/) &bull; [Episode 4: Proxies](/2020/04/27/scaling-mysql-stack-part-4-proxy/)
