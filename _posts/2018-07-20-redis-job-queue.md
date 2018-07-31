---
layout: post
title: Designing job queue in Redis
date: 2018-07-20
comments: true
published: true
---

Disclaimer: I come from the Ruby community where Resque and Sidekiq are the major job queue implementations. This post is about my findinds outside of the "comfort zone" tech stack. I'll use "job queue" and "message queue" terms in the post, but essentually I'm referring to the same thing: a list with pop and push operations.

I love playing with Clojure on my spare time and I stumbled upon a Redis library for Clojure which is called [carmine](https://github.com/ptaoussanis/carmine){:target="_blank"}.

Reading the docs, I was surprised to see that it has built-in message queue implementation. It's only about 300 LOC and [one file](https://github.com/ptaoussanis/carmine/blob/master/src/taoensso/carmine/message_queue.clj){:target="_blank"} which was easy to read and understand even at 5am after waking up from jet lag.

But I was even more surprised when I saw how its design around Redis keys for building a message queue. Before we dive into it, let's dig into how Resque and Sidekiq (popular job queue libraries in Ruby) use Redis.

See Redis keys that they rely on:

```
resque:queue:<qname> - set, job payload in JSON
resque:queues - set, list of available queues <qname>
resque:workers - set, list of active workers <wid>
resque:worker:<wid> - hash, { wid, job payload }
resque:worker:<wid>:started - key, timestamp
resque:workers:heartbeat - hash, { wid, timestamp }
```

When a job is pushed to the `low` queue, the following Redis commands would be called:

```
SADD resque:queues low
LPUSH rescue:queue:low <job payload>
```

Now a worker would start and take the job from the queue:

```
SET resque:worker:<wid>:started <NOW>
HSET resque:workers:heartbeat <wid> <NOW>

RPOP resque:quques:low # fetch job and the payload
HSET resque:workers:<wid> <job payload> # declare itself as working on the specific job
... execute the job handler
HREM resque:workers:<wid> # when the work is done
```

(forgive me if I missed any operations here!)

This design of keys in Redis was [brought up](https://github.com/resque/resque/tree/v0.0.1){:target="_blank"} by Resque since the very beginning. Later, when Sidekiq came around, Mike Perham [wanted](https://github.com/mperham/sidekiq/wiki/Resque-Compatibility){:target="_blank"} to preserve compatibility with Resque and used the same keys structure in Sidekiq:

> I try to make Sidekiq compatible with Resque where possible and appropriate; this makes it easy to try out Sidekiq for those who are already using Resque.

So the very keys design that Resque and Sidekiq are using now in 2018 is coming back from Resque 0.0.1 in 2010.

Now let's take a look at what carmine (the Clojure implementation) [offers](https://github.com/ptaoussanis/carmine/blob/master/src/taoensso/carmine/message_queue.clj){:target="_blank"}. Here is its keys structure:

```
carmine:mq:<qname>:messages     - hash, {mid mcontent}.
carmine:mq:<qname>:locks        - hash, {mid lock-expiry-time}.
carmine:mq:<qname>:backoffs     - hash, {mid backoff-expiry-time}.
carmine:mq:<qname>:nattempts    - hash, {mid attempt-count}.
carmine:mq:<qname>:mid-circle   - list, rotating list of mids.
carmine:mq:<qname>:done         - set, awaiting gc, requeue, etc.
carmine:mq:<qname>:requeue      - set, for `allow-requeue?` option.
carmine:mq:<qname>:eoq-backoff? - ttl flag, used for queue-wide
                                    (every-worker) polling backoff.
carmine:mq:<qname>:ndry-runs    - int, number of times worker(s) have
                                    burnt through queue w/o work to do.
```

Note: `mid` is the "message id" in carmine's terminology. You can think of it as a "job id" in Ruby land.

You'll soon start noticing how much different is this approach when compared to Resque. `mid-circle` key is essentially a [Circular list](https://redis.io/commands/rpoplpush#pattern-circular-list){:target="_blank"} that makes the queue reliable. Refer to the [implementation](https://github.com/ptaoussanis/carmine/blob/master/src/taoensso/carmine/message_queue.clj){:target="_blank"} if you need more clues around how it works.

Let's look at Redis operations that happen when jobs are enqueued and processed.

```
# enqueue to the low queue
HSET carmine:mq:low:messages <job id> <job payload>
LPUSH carmine:mq:low:mid-circle <job_id>
```

Notice that the job payload and the list of job ids in the queue are stored separately.

```
# dequeue
RPOPLPUSH carmine:mq:low:messages carmine:mq:low:messages # move the job from the head to tail within the same list, return <job id>
HGET carmine:mq:low:messages <job id> # fetch the job payload
HSET carmine:mq:low:locks <job id> {expiry} # acquire a lock
... execute the job handler
SADD carmine:mq:low:done <job id>
```

Notice that the `<job id>` stays in the list, but it's marked as "done" so it wouldn't be processed more than once. It will be cleaned up later when another worker takes a "done" job.

I've been amazed how completely different this Redis keys setup is! It allows carmine's message queue to be **resilient** by default: if a worker dequeued a job but died later and didn't mark it as "done", it will be processed by another worker after the lock expires.

Of course you can still do the hack the same feature into Resque, but with its keys structure the implementation would be orders of magnitude more complex (we actually did that at Shopify).

Another aspect is atomicity. You can see that enqueue and dequeue operations involve multiple commands, and if connectivity to Redis is lost or Redis goes does, it's possible to get the store into inconsistent state. Resque works around that by enforcing TTL on as many keys as possible and pruning dead workers from the set.

Carmine, in contrast, leverages [Lua support](https://redis.io/commands/eval){:target="_blank"} in Redis and makes [enqueue](https://github.com/ptaoussanis/carmine/blob/master/src/lua/mq/enqueue.lua){:target="_blank"} and [dequeue](https://github.com/ptaoussanis/carmine/blob/master/src/lua/mq/dequeue.lua){:target="_blank"} atomic by making them Lua scripts.

The most of Carmine's message queue implementation was developed in 2012-2013, which is not too long from the initial Resque release, but you can see how much different and more advanced it is.

I'm wondering how we can use this as a lesson to:

1) see the variety of decisions that you can take when designing something on top of Redis

2) question whether we don't have to forever stick with Resque's keys design and try something different.

### Further read

* [Celery](http://www.celeryproject.org/){:target="_blank"}, job queue framework in Python. Has lots of interesting features that we (again) miss in Ruby.
* [Fairway](https://github.com/customerio/fairway){:target="_blank"}, Ruby library for multi-tenant queues on top of Redis.
