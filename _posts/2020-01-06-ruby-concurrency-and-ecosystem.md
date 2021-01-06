---
layout: post
title: "Ruby 3, concurrency and the ecosystem"
date: 2021-01-06
comments: true
published: true
---

With the [Ruby 3.0 release](http://www.ruby-lang.org/en/news/2020/12/25/ruby-3-0-0-released/){:target="\_blank"}, there's been a lot of chatter about concurrency, parallelism, and async IO.

For my own reflection, I wanted to write down what that means for performance and capacity/costs of apps, and what would be the impact on the Ruby ecosystem.

I will assume that the audience already knows the difference between [threads vs processes model in UNIX](<https://en.wikipedia.org/wiki/Thread_(computing)#Threads_vs._processes_pros_and_cons>){:target="\_blank"} and the [Little's law](https://en.wikipedia.org/wiki/Little%27s_law){:target="\_blank"}.

## Learning from Python

It's always good to take learnings from other languages. There's an excellent [write-up "Async Python is not faster" by Cal Paterson](http://calpaterson.com/async-python-is-not-faster.html){:target="\_blank"}.

It argues that process-based (aka forking) web servers **show better latencies for web requests** when they are compared to async IO-powered servers.

But why? That's because async IO brings co-operative scheduling, which means that the execution is only yielded upon language keywords like `await`.

Quoting the author, this means that execution time is not distributed "fairly" and one thread can inadvertently starve another of CPU time while it is working. This is why latency is more erratic.

> In contrast, traditional sync webservers use the pre-emptive multi-processing of the kernel scheduler, which works to ensure fairness by periodically swapping processes out from execution. This means that time is divided more fairly and that latency variance is lower.

**What does that mean for us Ruby developers?**

While async IO reduces the [context switching](https://en.wikipedia.org/wiki/Context_switch){:target="\_blank"}, it increases the overall latency - which is worth it for background jobs but for not for web requests.

| Workload     | Latency requirements     |                           |
| ------------ | ------------------------ | ------------------------- |
| Web requests | Latency sensitive 🏎      | More context switching 📈 |
| Batch jobs   | Not latency sensitive 🐢 | Less context switching 📉 |

It's nice to reduce context switching where we can because scheduler switching from one task to another always adds a little overhead. Since that happens thousands of times every second, **less context switching would mean fewer CPU cycles wasted**.

Depending on the workload, we can trade less context switching for worse latency, or the other way around.

## Where does Ractor fit in?

The Ractor pattern allows parallel execution (which wasn't possible in Ruby before) of more than one Ruby thread by limiting the shared state of a block of code that you want to execute in parallel. Those "blocks of code" (aka "actors") can also talk to each other through messages. This is the [Actor model](https://en.wikipedia.org/wiki/Actor_model) used in other languages.

There are two ways we could leverage Ractors for modern apps: from the top (wrap every worker into a Ractor) and from the bottom (selectively use Ractors within existing code to parallelize CPU-intensive work).

While I see more to be gained from the top way, it seems like there's so much shared and mutable state in Ruby libraries that it's going to be quite tricky, although not impossible. It will likely take some efforts and at least a year of work from the community to push libraries towards less shared state. For the next year, we'll mostly see Ractor maturing and getting adopted in the "bottom" use cases.

## Impact on the Ruby ecosystem

Given my points from above, I could see web servers continuing to use the process (aka forking) model for a while (e.g. [Unicorn](https://github.com/defunkt/unicorn){:target="\_blank"}). Those applications that are built with thread safety in mind will continue using [Puma](https://github.com/puma/puma){:target="\_blank"}, perhaps in the [clustered mode](https://github.com/puma/puma#clustered-mode){:target="\_blank"}).

**For async workloads like background jobs, I could see the ecosystem slowly moving into the async IO model**. Having Sidekiq execute jobs concurrently through the event loop instead of threads could increase the throughput and save CPU work, especially for IO-bound workloads like webhook delivery.

**We'll need to push the Ruby ecosystem to have less shared state to fully leverage the Ractor pattern.** That will take us some time.

I'm looking forward to hearing your thoughts on this in the comments!
