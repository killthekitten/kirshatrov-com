---
layout: post
title: "Writing a Ractor-based web server"
date: 2020-09-08
comments: true
published: true
---

Ractor, the new concurrency primitive in Ruby, [has been merged](https://github.com/ruby/ruby/pull/3365){:target="_blank"} to the upstream few days ago. I’ve been following that PR and watching the author’s [talk at RubyKaigi](https://youtu.be/2ZcdiVSERuY?t=476){:target="_blank"}, which got me excited to try Ractor myself.

A web application server is the first thing that comes to mind when playing with concurrency. On top of that, not too long ago I’ve implemented TCP servers in Rust and Go, so I got curious to write a **simple web server using Ractor**.

Let’s dive in!

## What’s in a web server?

A web server is something that accepts a TCP socket, reads from it, parses HTTP headers and responds with HTTP body. It's a text-based protocol that is easy to implement.

Here's a sample request (what you'd read from the socket):

```
GET / HTTP/1.1
Host: localhost:10000
User-Agent: curl/7.64.1
Accept: */*
```

And a sample response (what you'd write):

```
HTTP/1.1 200
Content-Type: text/html

Hello world
```

We will start by grabbing a gist from the [Building a 30 line HTTP server in Ruby](https://blog.appsignal.com/2016/11/23/ruby-magic-building-a-30-line-http-server-in-ruby.html){:target="_blank"} post by AppSignal.

```ruby
require 'socket'
server = TCPServer.new(8080)

while session = server.accept
  request = session.gets
  puts request

  session.print "HTTP/1.1 200\r\n"
  session.print "Content-Type: text/html\r\n"
  session.print "\r\n"
  session.print "Hello world! The time is #{Time.now}"

  session.close
end
```

## Starting with Ractor

To get started with Ractor, I recommend to read the [doc](https://github.com/ko1/ruby/blob/dc7f421bbb129a7288fade62afe581279f4d06cd/doc/ractor.md){:target="_blank"} in the ruby repo.

Now, let's wrap the example from above into Ractors.

```ruby
require 'socket'
server = TCPServer.new(8080)
CPU_COUNT = 4
workers = CPU_COUNT.times.map do
  Ractor.new do
    loop do
      # receive TCPSocket
      s = Ractor.recv

      request = s.gets
      puts request

      s.print "HTTP/1.1 200\r\n"
      s.print "Content-Type: text/html\r\n"
      s.print "\r\n"
      s.print "Hello world! The time is #{Time.now}\n"
      s.close
    end
  end
end

loop do
  conn, _ = server.accept
  # pass TCPSocket to one of the workers
  workers.sample.send(conn, move: true)
end
```

We start the number of workers that equals the number of CPUs and have the main thread to listen to connections on the socket and send accepted connection to a random Ractor. We can validate that it works as expect by making a request with `curl`.

However, distributing requests among workers using `workers.sample` is not very efficient. That random worker might still be busy serving the previous request. We'd rather have workers pull from a shared queue where we'd send all requests.

I wanted to make that part better but I didn't find any Ractor-friendly queue implementation. However, the [doc](https://github.com/ko1/ruby/blob/dc7f421bbb129a7288fade62afe581279f4d06cd/doc/ractor.md){:target="_blank"} suggesting using a pipe like a queue. Let's try that!

```ruby
require 'socket'

# pipe aka a queue
pipe = Ractor.new do
  loop do
    Ractor.yield(Ractor.recv, move: true)
  end
end

CPU_COUNT = 4
workers = CPU_COUNT.times.map do
  Ractor.new(pipe) do |pipe|
    loop do
      s = pipe.take

      data = s.recv(1024)
      puts data.inspect

      s.print "HTTP/1.1 200\r\n"
      s.print "Content-Type: text/html\r\n"
      s.print "\r\n"
      s.print "Hello world!\n"
      s.close
    end
  end
end

server = TCPServer.new(8080)
loop do
  conn, _ = server.accept
  pipe.send(conn, move: true)
end
```

It worked! By using the pipe I was able to make all workers to pull for sockets which improved the load balancing part.

What's still not great is that there's nothing that monitors workers in case one of them unexpectedly dies. And similar to [Puma's architecture](https://github.com/puma/puma/blob/master/docs/architecture.md){:target="_blank"}, it would be more efficient to have a separate thread to wait for sockets to become ready to read before passing them to actual workers.

I was able to move listener into its own Ractor and to make the main thread to watch all Ractors:

```ruby
require 'socket'

pipe = Ractor.new do
  loop do
    Ractor.yield(Ractor.recv, move: true)
  end
end

CPU_COUNT = 4
workers = CPU_COUNT.times.map do
  Ractor.new(pipe) do |pipe|
    loop do
      s = pipe.take
      puts "taken from pipe by #{Ractor.current}"

      data = s.recv(1024)
      puts data.inspect

      s.print "HTTP/1.1 200\r\n"
      s.print "Content-Type: text/html\r\n"
      s.print "\r\n"
      s.print "Hello world!\n"
      s.close
    end
  end
end

listener = Ractor.new(pipe) do |pipe|
  server = TCPServer.new(8080)
  loop do
    conn, _ = server.accept
    pipe.send(conn, move: true)
  end
end

loop do
  Ractor.select(listener, *workers)
  # if the line above returned, one of the workers or the listener has crashed
end
```

Again, it worked!

The next step of implementing a web server would be to bake a HTTP parser to read request headers. There's a [http-parser](https://github.com/cotag/http-parser){:target="_blank"} gem that is using a C extension, and I've heard that is not supported by Ractor yet.

I found an HTTP parser that comes as a part of WEBrick which is a built into Ruby's standard library.

I tried the following snippet:

```ruby
require 'webrick'

CPU_COUNT = 4
workers = CPU_COUNT.times.map do
  Ractor.new(pipe) do |pipe|
    loop do
      s = pipe.take

      # raises "can not access non-sharable objects in constant HTTP by non-main Ractors (NameError)"
      req = WEBrick::HTTPRequest.new(WEBrick::Config::HTTP)
      req.parse(s)

      s.print "HTTP/1.1 200\r\n"
      s.print "Content-Type: text/html\r\n"
      s.print "\r\n"
      s.print "Hello world!\n"
      s.close
    end
  end
end
```

`WEBrick::Config::HTTP` turned to be a mutable hash with some configuration objects. Since that constant and a hash were initialized in the main thread, it wasn't allowed to be safely used from ractors. I worked around by inlining the hash definition but then I hit another non-shareable constant referenced from the WEBrick code that wasn't too easy to inline.

This is probably the part that will improve on the upstream very soon. After all, this is the earliest Ractor implementation.

## The end

I'm really excited about new concurrency primitives like Ractor getting pushed into Ruby's upstream.

The Ractor model seems powerful and ready for experimental use. Within the next 6 months (Ruby 3.0 release is scheduled for December), I foresee a Ractor-based web server to come out to leverage this feature and get the most out of server CPUs. This is a great opportunity to learn concurrent programming and to contribute to the Ruby community.

For those curious to try Ractor, I'd suggest to try implementing other things that benefit from parallel execution, for instance a background job processor.

To try Ractor, you'll need to build Ruby from the upstream. Read my previous posts ([Contributing to Ruby MRI](https://kirshatrov.com/2020/01/11/contributing-to-mri/){:target="_blank"}) to learn about how to do that.
