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

<p class="upd">
Updated on Jan 9, 2021: thanks to the feedback from <a href="https://github.com/ioquatix" target="_blank">Samuel Williams</a>, I’ve revised the post with findings from <a href="https://github.com/socketry/falcon" target="_blank">Falcon</a>, the async web server written in Ruby.</p>

## Learning from Python

It's always good to take learnings from other languages. There's an excellent [write-up "Async Python is not faster" by Cal Paterson](http://calpaterson.com/async-python-is-not-faster.html){:target="\_blank"}.

It argues that process-based (aka forking) web servers **show better latencies for web requests** when they are compared to async IO-powered servers.

But why? That's because async IO brings co-operative scheduling, which means that the execution is only yielded upon language keywords like `await`.

Quoting the author, this means that execution time is not distributed "fairly" and one thread can inadvertently starve another of CPU time while it is working. This is why latency is more erratic.

> In contrast, traditional sync webservers use the pre-emptive multi-processing of the kernel scheduler, which works to ensure fairness by periodically swapping processes out from execution. This means that time is divided more fairly and that latency variance is lower.

## Learning from Falcon

<p class="upd">
(added on Jan 9, 2021)
</p>

[Falcon](https://github.com/socketry/falcon) is a multi-process, multi-fiber HTTP server written in Ruby that is already utilizing async IO.

It has a great [set of benchmarks](https://github.com/socketry/falcon-benchmark) that let us compare Falcon's async IO with other non-async web servers like Passenger, Puma and Unicorn. Those benchmarks have been showing that **async IO-powered server like Falcon** provides better latencies on web requests.

Interestingly, that’s a very different story than Python! Looking at Python, I’ve expected that the thread driven server should be more "balanced" but it turns out the opposite.

Falcon’s authors explain that the fiber scheduler naturally scales according to load much better than the worker pool implementation in Puma. When fibers are busy handling requests, they don't call `accept` so the requests are naturally picked up by other workers who are less busy.

### What does that mean for us Ruby developers?

Scheduling threads and fibers is nuanced, and you can see that similar approaches demonstrate different results on Python and Ruby/Falcon examples.

In the first revision of this post, I’ve argued that async IO may often increase the latency. Thanks to the data [shown](https://github.com/socketry/falcon-benchmark) by Samuel Williams, we can see that’s not the case.

One of the benefits of async IO is that concurrency is archived by the `yield`/`await` instruction, not by the constant interrupt of threads. Every interrupt causes the context switch - and it's nice to reduce context switching where we can because scheduler switching from one task to another always adds a little overhead. Since that happens thousands of times every second, **less context switching would mean fewer CPU cycles wasted**.

## Where does Ractor fit in?

The Ractor pattern allows parallel execution (which wasn't possible in Ruby before) of more than one Ruby thread by limiting the shared state of a block of code that you want to execute in parallel. Those "blocks of code" (aka "actors") can also talk to each other through messages. This is the [Actor model](https://en.wikipedia.org/wiki/Actor_model) used in other languages.

There are two ways we could leverage Ractors for modern apps: from the top (wrap every worker into a Ractor) and from the bottom (selectively use Ractors within existing code to parallelize CPU-intensive work).

While I see more to be gained from the top way, it seems like there's so much shared and mutable state in Ruby libraries that it's going to be quite tricky, although not impossible. It will likely take some efforts and at least a year of work from the community to push libraries towards less shared state. For the next year, we'll mostly see Ractor maturing and getting adopted in the "bottom" use cases.

## Impact on the Ruby ecosystem

**By itself, async IO will help to use CPU more efficiently by reducing context switching.**

Better support for async IO in Ruby 3.0 will increase community's adoption of async web servers like Falcon, and will hopefully give birth to async background job systems.

Having Sidekiq execute jobs concurrently through the async IO and event loop instead of threads could increase the throughput and save CPU work, especially for IO-bound workloads like webhook delivery.

**We'll need to push the Ruby ecosystem to have less shared state to fully leverage the Ractor pattern.** That will take us some time.

If you've enjoyed reading this, I highly recommend to read _[Ruby 3.0 and the new FiberScheduler interface](http://wjwh.eu/posts/2020-12-28-ruby-fiber-scheduler-c-extension.html){:target="\_blank"}_ by Wander Hillen.

Thanks to Samiel Williams and to Julik Tarkhanov for providing early feedback on this post.

I'm looking forward to hearing your thoughts on this in the comments!
