---
layout: post
title: Signal handling in Ruby and its internals
date: 2017-04-17
comments: true
published: true
---

> Mixing posix threads and signal handling usually is a bit of a nightmare.

[Ceri Storey, 2013](http://www.mikeperham.com/2013/02/23/signal-handling-with-ruby/#comment-1663908584)

I have been debugging signal handlers in Ruby and at some point I started to ask questions that no one could answer.
The only way to find answers for them was to read the MRI internals. Just in case, I've decided to document my observations
in a blog post.

I'm assuming that you already have a context about [signal handling in Linux](http://www.alexonlinux.com/signal-handling-in-linux)
and the [Ruby API](http://ruby-doc.org/core-2.4.1/Signal.html) for it.

**In what context is the signal handler executed?**

Ruby executes the signal handler in the same thread as the parent. It can be proven by

```ruby
puts "parent: #{Thread.current.object_id}"
trap("TERM") { puts Thread.current.object_id }
sleep
```

The thread [struct](https://github.com/ruby/ruby/blob/cf6ec79b37a2efcd477ff76c480c570bcf17bf69/vm_core.h#L762-L763) has `interrupt_flag` and `interrupt_mask` fields (dunno why they made it two fields).

When the signal is trapped, the current (main) thread is marked with `TRAP_INTERRUPT_MASK` ([[1]](https://github.com/ruby/ruby/blob/cf6ec79b37a2efcd477ff76c480c570bcf17bf69/thread.c#L414), [[2]](https://github.com/ruby/ruby/blob/cf6ec79b37a2efcd477ff76c480c570bcf17bf69/signal.c#L982)). The current executing thread is [put on hold](https://github.com/ruby/ruby/blob/cf6ec79b37a2efcd477ff76c480c570bcf17bf69/signal.c#L982) and the VM runs the signal handler.

**What is safe to do from a signal handler?**

I found only one place that explicitly forbids from being called inside a signal handler. This place is `Mutex#lock`. It [prevents](https://github.com/ruby/ruby/blob/cf6ec79b37a2efcd477ff76c480c570bcf17bf69/thread_sync.c#L245) user from locking a mutex from the signal handler by the [design](https://bugs.ruby-lang.org/issues/7917). This is not a huge limitation, but it prevents you from using `Logger` which relies on using a mutex. However, `puts` still works.

**Update:** see a [thread](https://bugs.ruby-lang.org/issues/14222) in Ruby bug tracker where contributors discuss what id safe to do from a signal handler.

**Then how do you log from the signal handler?**

I've questioned myself: why can't you use `Logger` inside signal trap when Resque is [doing it](https://github.com/resque/resque/blob/master/lib/resque/worker.rb#L916) without any troubles? The answer is that Resque is using [mono_logger](https://github.com/steveklabnik/mono_logger), which is a mutex-free logger implementation. It works just well from the signal trap!

At Shopify we are logging to Kafka which doesn't rely on a mutex, meaning that we are also free to log from a signal handler.

***

If you're curious, here are the spots in MRI sources that define signal trap behaviour:

* [thread.c#rb_threadptr_execute_interrupts](https://github.com/ruby/ruby/blob/cf6ec79b37a2efcd477ff76c480c570bcf17bf69/thread.c#L2030)
* [signal.c#signal_exec](https://github.com/ruby/ruby/blob/cf6ec79b37a2efcd477ff76c480c570bcf17bf69/signal.c#L967)
* [thread.c#rb_threadptr_interrupt_common](https://github.com/ruby/ruby/blob/cf6ec79b37a2efcd477ff76c480c570bcf17bf69/thread.c#L410)

Further reading:

* [MRI Bug #7917](https://bugs.ruby-lang.org/issues/7917)
* [Mike Perham: Signal Handling with Ruby 2.0](http://www.mikeperham.com/2013/02/23/signal-handling-with-ruby/)
* [Best practices of Signal handling in Ruby](https://gist.github.com/mvidner/bf12a0b3c662ca6a5784)
