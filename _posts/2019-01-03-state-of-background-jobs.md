---
layout: post
title: The State of Background Jobs in 2019
date: 2019-01-03
comments: true
published: true
---

In 2018, my work at Shopify was hugely focused around the Job Patterns team. The team owns all kinds of asynchronous units of work, things like background jobs and database migrations. The tech we've built helped to power [10% of e-commerce](https://twitter.com/tobi/status/1067821619379429376){:target="_blank"} last Black Friday. The [job-iteration gem](https://github.com/Shopify/job-iteration){:target="_blank"} is one example of what we've released.

After a year of consulting so many developers about how to design background jobs that scale, while being on-call for all infrastructure related to jobs processing, it seems clear to me that currently common architecture of Redis + set of queues + application-level library like Sidekiq or Resque to process serialized payloads **is not going to scale well**, especially for multi-tenant monoliths like Shopify with hundreds of developers working in the same codebase.

There are at least two sides of the jobs framework that I see: developer-facing API and infrastructure side, which executes the work behind the curtain and can sometimes get delayed or go down. I'm going to cover both in this post and mention why I think that both of them are having gaps at scale.

## Developer API

This part is what developer experiences when they create a new class and type `class WebhookJob < ActiveJob::Base` or something similar.

Developers care about shipping features, and there are 2 units of work where they can put the logic: web requests (synchronous) and jobs (asynchronous). The rule of thumb is to do less work in web requests to make the experience fast and do everything else in the background. Processing payments, sending emails and importing data are good examples.

For web requests, there's usually a request timeout to avoid browser waiting forever, but there's nothing like that for jobs. At the same time, it's too easy for a developer to introduce a job that takes a long time to run ("long-running job") and make it unsafe to shutdown the app because the infrastructure would always have to wait for the job to finish. That's what [Job Iteration API](https://github.com/Shopify/job-iteration){:target="_blank"} solves by making all jobs **interruptible and resumable by design**.

We've introduced the API to Shopify codebase around 1.5 years ago, and while by now most of the jobs have switched to use Iteration, there's a long-tail of infrequent jobs that are still not interruptible. I'd like the next-gen jobs framework **to enforce interruptibility and max run time** for all job classes that developers introduce. If a job is not following the rules, it must be reported to developers and de-prioritized. We actually have a tool at Shopify that opens a GitHub issue and tags code owners if a job takes more than X seconds to run, but it's something that's not fully tracked and automated.

Another core concept of job framework is **queues**. A typical app would have a dozen queues (*critical, default, webhooks, low, imports, payments etc*) and the developer would have to choose one for their job. As you can see, the set of queues has a mix of priority based queues (*critical, default, low*) and domain-specific queues (*webhooks, imports, payments*). Ideally, we could merge domain-specific queues into priorities: `payments` are `critical`, `imports` and `webhooks` are `low`. But in reality, it comes to the fact that `payments` would be more important than other jobs in `critical`, or `webhooks` being less important than jobs in `low`, so developers go ahead and introduce both priority-based and domain-based queues. We end up with an order like `payments > critical > default > low > webhooks`.

The definition of something being "critical" maps poorly to the concept of SLOs, since it doesn't tell whether "critical" means it has to run in 1s or in 30s. It can be hard for a developer to choose the right queue, and often they wouldn't want their job to go to "low" because that sounds bad, even if (in case of Shopify) "low" means execution within 30 seconds.

If your codebase stays around for a decade, you'll have even more queues like "lower than low". It's fair to give something a lower priority and allow a longer delay in execution, but that makes it even harder for developers to choose the right queue from that large set of queues.

The whole concept of queues has issues with aging and scaling in terms of the codebase and people. I'd love to see some other concept of prioritizing jobs between buckets, based on SLOs ("this thing has to run in 5 minutes") and maybe a number-based priority rather than a hardcoded queue name. From the API point, this could look as simple as `slo 5.minutes, weight: 0.5` in the job definition. Why two settings? I could be wrong, but I have a feeling that you'll need some metric for prioritizing when you have a backlog with 5M of "had to run 1 min ago" jobs.

**Concurrency and throttling.** It's common for developers to want their job to run at a certain rate. A good example is 3rd party calls, when you may have 1k jobs per second incoming while you know that the 3rd party provider will not handle that number of calls per second,  even if you've had the capacity to run all of those jobs at once. Webhooks is a real-life example: when your store on Shopify will get a ton of new orders (congrats with large sales!) and you have a webhook endpoint configured, we won't even attempt to deliver them all at once because it's unlikely that those external endpoints will keep up with that throughput of webhooks. Instead, we'll deliver them at a fixed rate.

Another use case is concurrency of `1`, when you want to say "only one job in the scope of X is allowed to run at any given time". You might preserve the order of jobs or not, and the implementation gets quite complex if you do.

*Sidekiq Enterprise* provides the [rate limiting module](https://github.com/mperham/sidekiq/wiki/Ent-Rate-Limiting){:target="_blank"} which helps to cover part if this feature, but the developer still has to come up with a certain number for rate limiting. However it's usually hard for them to estimate that rate limit, and the limit is likely to change as the platform grows. In the perfect world, the framework could automatically detect when it's necessary to back-off the execution rate. With a simple algorithm, it could attempt to deliver jobs at a higher rate and slowdown when the downstream is throwing exceptions.

**Multitenancy.** Multitenant applications will eventually run into the problem of enforcing fairness between jobs in the queue from different customers. If customer A triggered 100K jobs and then customer B triggered 1K jobs, with a FIFO queue that would mean that customer B jobs are executed only after all customer A jobs, which might take a while. If all of those are high priority jobs, and 100K jobs take at least some time, customer B is likely to experience delays in service. It's somewhat solvable by heavy sharding and rate limiting in the most critical paths, but it's still quite manual. I'd love the next-gen job framework to be multi-tenant first and to be able to enforce fairness, for instance by shuffling those 100K and 1K jobs of customers A and B.

Now, let's talk about the other side of background jobs, which is only visible to engineers who are on-call for it.

## Infrastructure side

A common setup in the industry (at least in the Rails world) is having a Redis instance which stores a FIFO queue with all the jobs the application enqueued. There would be workers running that de-enqueue payloads and perform the work. At some point you might scale up the number of workers to perform more work if you've got an extra load.

At the same time, we must remember Redis constraints. It's an **in-memory** database that can persist the state to disk to be prone to restarts, but it still won't be able to store more data than RAM available. This is an important detail for a large-scale jobs setup.

Imagine the following scenario: increased traffic to your service leads to millions of jobs of a certain type enqueued, and those are jobs that you can't process at a higher rate than X - for instance because they talk to a 3rd party service that doesn't allow too many calls. The backlog of jobs is only growing (because your campaign is getting success) and the Redis is filling up. Remember it's an in-memory database, so it can't store more than RAM available. It's common to set Redis `maxmemory` to 8 or even 16Gb, but even that has a limit of how many jobs it can store in the queue.

If the traffic stays high for longer than a period that's enough to fill Redis, the Redis will get into Out Of Memory (OOM) state, meaning that it can't accept any more writes. To be precise it can still allow the *dequeue* (RPOP) operation, but not *enqueue*.

In contrast with Redis, relational databases like PostgreSQL are backed by the disk rather than RAM, which unlocks them to store more data than they have RAM available. Of course, writing to disk is way slower than writing to memory so that nothing can beat Redis performance - but in a situation when Redis runs out of memory, you'll probably prefer slow writes than no writes at all.

When the incoming rate of jobs is higher than the fixed rate delivery, your Redis goes into the danger of filling up. After all, there must be other open-source databases that somehow provide a message queue without in-memory constraints like those Redis has. Let's review them.

**Kafka:** data is persisted to disk, though running a Kafka cluster and consuming from it is a lot trickier compared to Redis, due to its distributed nature and more complex protocol.

**RabbitMQ:** under memory pressure, the persistence layer tries to write as much out to disk as possible, and remove as much as possible from memory.

The next two databases you likely haven't heard about.

**Beanstalkd:** (unsupported) all data is always kept in memory. Similar to Redis, can persist a binlog to disk for recovering the state after a restart.

**Kestrel:** (unsupported) a message queue database fully backed by disk. It's actually used by GitHub to deliver webhooks on a massive scale, and I guess it's what allowed them to put webhooks on hold during the [October outage](https://blog.github.com/2018-10-30-oct21-post-incident-analysis/){:target="_blank"}, and deliver them later.

**MySQL or PostgreSQL.** It's [not](https://github.com/collectiveidea/delayed_job){:target="_blank"} [uncommon](https://github.com/QueueClassic/queue_classic){:target="_blank"} to implement job queue with a relational SQL database, which persists data on disk and allows to store large backlogs with no constraints on RAM.

**Faktory**. It's not a database per se, but rather a jobs service behind the application, developed by the author of Sidekiq. In the early days, it used **RocksDB**, an embedded database from Facebook, which is backed by the disk - so the number of jobs pushed to Faktory was not limited by RAM, which was great. In the current version, Faktory has [switched](https://github.com/contribsys/faktory/wiki/Redis){:target="_blank"} to Redis as a store instead of RocksDB for good reasons, which means it's still bound by Redis limitations.

As you see, there's many stores that are able to persist data to disk and avoid in-memory constraints that Redis has.

From my perspective, there are at least three reasons why it's been hard for large-scale services to explore other options and move away from Redis.

1) Redis is extremely easy to set up and operate, unlike distributed Kafka or RabbitMQ

2) Redis can store not only queues but a lot of other data types, which are often used for jobs metadata outside of queues. If we ever wanted to switch from Redis to an actual message queue, we'd need to find a new home for the rest of data about jobs that is nowadays stored in Redis, for instance locks for [unique jobs](https://github.com/mhenrixon/sidekiq-unique-jobs){:target="_blank"}.

3) Redis is an in-memory store, and memory is incredibly fast to write and read. When you're used to a store that can serve [almost 1M writes per second](https://redis.io/topics/benchmarks){:target="_blank"}, you'll come to a realization that disk is never as fast as RAM, and none of disk-backed stores will be able to give the performance that's close to the in-memory store. Depending on your workloads, switching from Redis would be a hit for performance that you're used to.

We've become so used to a fast in-memory store which made it so hard for us to switch to a slower but more reliable store.

Another feature that's critical to operating jobs is the ability to **blackhole** certain jobs. Imagine that due a bug in the app there's a large number of faulty jobs that ended up in the queue. Since it's a FIFO queue, they're blocking other jobs from running, so you'd want to delete those faulty jobs from the store as soon as possible.

But hey, it's not as easy to delete stuff from the queue (aka list) data type as you may have thought. To remove items from the list you'd have to rewrite it while blocking all other writes. It also has O(N) complexity, which is a huge hit when you have a backlog of thousands and millions of jobs.

To tackle that, we never remove items from the queue in production. Instead, we create a rule for workers which take jobs from the queue. Usuallym the rule looks like `ignore all jobs of class ImportJob with customer_id=123 in the arguments`, in case we know that `customer_id` is creating faulty `ImportJob` that's somehow causing problems for the rest of platform. This is similar to the *tombstone* concept that's often used in databases when instead of deleting an already persisted record right away it would write a special tombstone flag to indicate that the record has been deleted. Eventually, the pairs of record + tombstone are cleaned up.
Since job blackhole rules are created dynamically and stored in a global database, we can apply them as soon as possible without re-deploying the app. You can't imagine how many times it saved backs for my colleagues who were on-call.

Essentially the blackhole feature provides manual **Load Shedding**. [Load Shedding](https://landing.google.com/sre/sre-book/chapters/addressing-cascading-failures/){:target="_blank"} is a mechanism that explicitly rejects extra work when it detects that the system is at the peak of load, instead of letting that load to crash the system. It's a common pattern used by many large scale web services. Instead of serving all HTTP request as usual when the system is experiencing overload, it starts rejecting some percentage on low-priority requests on purpose, trying to reduce the load on the system.

A similar approach could be used for jobs: when we detect an enormous stream of new jobs, we start rejecting some of them if we know that system is at the peak capacity. There's a lot to play with here: some jobs tolerate delayed execution and some not. A good example is jobs that only care about being executed _now_, which means that they become useless when executed later.

## The Future

Large scale web services are starting to outgrow the Redis-backed queue system which has been so common in the web dev industry for the last 10 years.

Based on features that I described, the job framework of a dream would:

1) enforce constraints on how long the job may run, and complain about non-interruptible jobs

2) provide a better way to prioritize jobs rather than give a set of queues, which would help to define SLOs and alert on their violations

3) automatically adjust the concurrency and rate limits for jobs that talk to external services

4) be multitenant-first and provide fairness between tenants

5) be able to store a larger backlog of jobs than RAM available

6) automatically shed the load when the system is at the peak of capacity

While it's possible to hack maybe 50% of that with Sidekiq Enterprise and a bunch of gems, it's still going to be manual, and you never know if that gem works with Redis in a way that's going to scale.

It's also fair to say that 99% of apps are totally fine with what the current ecosystem offers, and they don't need all those features I described. If the next-gen jobs framework is ever going to evolve, it's likely to be backed by a large company.

## The Vision

How could it look like from the design perspective? One thing I learned last year, is that baking all features that I talked about into job workers makes them too complex and creates overhead, both for humans and for operations. Workers are meant to be scaled horizontally, and having each of thousands of workers pull the blackhole rules or concurrency settings is going to be expensive for the datastore. You'll end up caching it to minimize the load and introducing all sorts of workarounds, all on the worker level.

It would be interesting to see if we can come up with some kind of "jobs proxy", which would allow us to move most of the complexity there and make workers as dumb as possible. Introducing a proxy behind a datastore is a common case (look for for *pgbouncer, proxysql, twemproxy*), and there are even existing proxies for Redis. However those are abstract of what you store in Redis, and mostly focus on key/value lookups.

I'm talking about a jobs-specific proxy which would take care of all things like enforcing fairness between tenants, rate limits or load-shed jobs if needed. Even for thousands of workers, we'd need to run only a few replicas of that proxy, so we could largely reduce the overhead for all those features. The worker itself would not be aware of backed database since that will be the concern of a proxy, unlike now when workers talk directly to Redis and we end up implementing resiliency patterns like circuit breaks on top of Redis clients.

The [Faktory](https://github.com/contribsys/faktory){:target="_blank"} project by the author of Sidekiq is very close to what I'm talking about here. It's a Go proxy between job workers and the database, and it takes care of enqueueing and dequeueing jobs while providing extra features like unique jobs and acknowledgment of execution. However, it [deliberately chose](https://github.com/contribsys/faktory/wiki/Redis){:target="_blank"} Redis as storage. In fact, it starts the Redis sub-process inside Faktory, giving very little control of Redis to engineers. This is great for most of Faktory users who may have little experience configuring Redis properly, but I imagine that large-scale consumers would still want to own and monitor Redis by themselves. And Redis still brings all the in-memory constraints that I've mentioned above. The max capacity of the queue would be equal to the RAM that Redis has available.

---

I also have to admit that whatever I imagined in this post could take massive investments and have not too much value for the business, as long as you're able to optimize the current setup with Redis, reduce extra load and make it handle more than it currently does.

Who knows, maybe this is just an idea for an upcoming Hack Days?

<div class="kirs-highlighted">
  If problems mentioned resonate with what you're working on, I'd be very curious to hear from you! Reach out to <a href="https://twitter.com/kirshatrov">@kirshatrov</a> on Twitter (my DM is open) or at <a href="mailto:kir@kirshatrov.com">kir@kirshatrov.com</a>.
</div>