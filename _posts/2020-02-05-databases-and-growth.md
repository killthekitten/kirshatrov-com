---
layout: post
title: Databases and company growth
date: 2020-02-05
comments: true
published: true
---

You start a company, make the MVP in Ruby on Rails or whatever another technology is hyped at the moment, raise a round of investments, and start hiring people. All of your production fits in the Hobby plan on Heroku and a single database (also managed by Heroku).

A few years after, your headcount is a couple hundred people, and the business is growing as well as demands for the app. You start noticing occasional load on that Heroku-managed database. This load could be analytical workloads like reports or a particularly noisy customer that hits a path that's no so well optimized for the DB access.

You move analytical workloads on a read-only replica of the primary DB and optimize that inefficient feature to use the right index. Maybe add some caching here and there. The DB load is back to the steady-state.

Another few years after, the demand for your app is so high that the primary database is not handling the number of writes that your customers do. This could be celebrity sales doing thousands of checkouts per second or the number of cab rides spiking every Friday night PST time.

You decide to shard your primary database by some sharding key. For a SaaS company that's likely to be a column like `business_id` (because businesses don't overlap with each other). For a cab company, this could be something tied to the geography (maybe a neighborhood or a city). If done right, sharding will let your your infrastructure to scale horizontally and add 2x more shards with 2x more load.

Another few years pass (think a 10-15 years old company), and your biggest customers are starting to push boundaries of a single shard. Of course, you could give them a fully dedicated shard (maybe with higher CPU DBs), but even that might not be enough for the capacity they want - imagine peak hours in San Francisco giving stress the SFO shard of the cab company, or a high volume seller peaking in numbers of checkout on their own shard.

You spawn teams to optimize the performance of those features and educate everyone around the company to be more smart about working with the database, but you also know that will only buy you time. At this growth rate, you will eventually still outgrow the capacity of a single shard. On top of that, the number of new features introduced will, at some point, outgrow the existing features that you've been trying to optimize for less database pressure.

This is especially common for any organization that ended up with an ORM (Object-relational mapping) as the core piece in their codebase. The largest benefit of ORMs is flexibility and iteration speed - which is great to bootstrap the business, but comes at a cost when you want everything on the critical path to be well optimized - and not crash the DB when someone puts the wrong `ORDER BY` that messes up with an index.

At this point of scale, I've seen many companies invest in their own, domain-specific data stores. At Facebook, everything is a relation on the graph (a post has comments, comments have likes, pages have likes). It was natural for them to introduce [TAO](https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf){:target="_blank"}, an internal data store for the social graph backed by MySQL and memcached. For Uber, trip data is always append-only, and often without a schema. So they came up with [Schemaless](https://eng.uber.com/schemaless-part-one/){:target="_blank"}, a distributed key/value append-only store on top of MySQL.

By specializing the data model and reducing the developer contact to a narrow set of APIs that are easier to scale, they gave developers a set of tools that scales by default. By having a narrow set of APIs you'll allow the platform team to optimize those specifically, and it's a lot easier to optimize append-only log (in case of Schemaless) than any-query-that-a-developer-can-construct with an ORM like ActiveRecord.

Most often, these domain-specific databases are wrappers on top of existing, community-wide stores like MySQL, Postgres or etcd. But if you feel like you're not ready to go that far to run your own DBaaS, there's still plenty of things that could be done on the application side to enforce stricter patterns for DB access.

One company that I spoke to had a point when they suffered from a series of outages, all related to human mistakes in making the ORM to build a query that would not hit the right index. As a solution, they changed their approach to the ORM by enforcing everyone to explicitly declare all queries - think `scope` from ActiveRecord, but without possibility to chain them. On CI, they validate that all defined queries hit proper indexes. This would be a lot harder to achieve if they kept allowing arbitrary ActiveRecord-style chaining like `.where(...).where(...).order(...)`.

If you're looking for more examples in addition to TAO and Schemaless, there are [Espresso by LinkedIn](https://engineering.linkedin.com/espresso/introducing-espresso-linkedins-hot-new-distributed-document-store){:target="_blank"}, [Edgestore by Dropbox](https://blogs.dropbox.com/tech/2016/08/reintroducing-edgestore/){:target="_blank"} and [Gizzard by Twitter](https://github.com/twitter-archive/gizzard){:target="_blank"}.

In the meantime, if we look at the history of YouTube, we'll notice they went the other way. At the point when they needed to shard, they've realized that the codebase became so big that it would be too much effort to rewrite it to support multiple databases and sharding. Instead, they came up with Vitess. From the application perspective, Vitess looks like a single MySQL instance and speaks the same protocol, but underneath it will talk to different MySQL nodes depending on what table and what data range the query is requesting. This approach allows Vitess to accomplish impressive things like the [live vertical split](https://vitess.io/docs/user-guides/vertical-split/){:target="_blank"} of a DB with minimum downtime and without making _any_ changes to the app, that would otherwise take weeks or months.

***

To summarize my points:

* At a particular scale, some companies start to look into creating a data store specific to their domain: [TAO](https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf){:target="_blank"} by Facebook, [Schemaless](https://eng.uber.com/schemaless-part-one/) by Uber, [Espresso by LinkedIn](https://engineering.linkedin.com/espresso/introducing-espresso-linkedins-hot-new-distributed-document-store){:target="_blank"}, [Edgestore by Dropbox](https://blogs.dropbox.com/tech/2016/08/reintroducing-edgestore/){:target="_blank"} and [Gizzard by Twitter](https://github.com/twitter-archive/gizzard){:target="_blank"}.

* This is dictated not only by scalability needs but also because giving less freedom to developers makes it easier to grow the org in terms of the headcount

* Sometimes the "do fewer things, but do them more performant" part can also be achieved by restricting your existing APIs (and making them less flexible) without having to build your own store

I'm very curios to learn more cases of this growth stage from other companies. I realize that there's only a handful of them that went through this stage of scale. Please reach out to me on Twitter or comment on the post if this topic interests you!
