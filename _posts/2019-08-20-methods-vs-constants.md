---
layout: post
title: Methods vs constants for static values in Ruby
date: 2019-08-20
comments: true
published: true
---

Recently, I’ve been part of a team that stumbled upon rewriting a legacy library into a new, refreshed API. That API would serve as a foundation for long-term development, so we’ve put some time to design it well.

We’ve had to agree on many aspects of the API design, and one of them was how we want to define static values. Even for something as simple as a name of reserved queue (in case you’re building a job framework), there’s at least 3 ways to define it:

```ruby
# Option 1

class Queue
  RESERVED_QUEUE = "reserved"
end

# Option 2

class Queue
  def self.reserved_queue
    "reserved"
  end
end

# Option 3

class Queue
  RESERVED_QUEUE = "reserved"
  def self.reserved_queue
    RESERVED_QUEUE
  end
end
```

In older versions of Ruby, Option 2 would had poor performance due duplicated string allocation - however, with frozen string literals, this is no longer a thing and the performance of all options is the same.

So, when would you choose Option 1, 2, or 3?

Personally I’d reject Option 3 altogether, because it was a way to write optimized Ruby when it lacked frozen string literals. You no longer have to do that, and since Ruby is meant to be elegant, you should use simpler forms without wrapping all repeating strings into constants. And for an outside reader, it introduces an extra hop compared to other options: you have to go from a caller of `reserved_queue` to `def reserved_queue` and then to the actual value in `RESERVED_QUEUE`.

This leaves Option 1 and 2. Some debates happened, where a great colleague of mine mentioned that if something is meant to be static, a constant is preferred to a method. I couldn’t argue with that, but I also cared about a nice external API in case the value was meant to be consumed outside of the same module.

I was able to make a rule of thumb that lets you pick the right one.

* If you expect consumers of the value to be inside the same module, define it as a private constant (Option 1)
* If you expect consumers to be outside of the module, that makes the static value publicly exposed, which means defining it as a method is likely the best (Option 2)

To rephrase it, where the consumer of an API lives defines whether it should be a constant or a method.

In the example from above, the reserved queue name has been extensively consumed around the codebase, which made us choose `Queue.reserved_queue` as a public and documented accessor.
