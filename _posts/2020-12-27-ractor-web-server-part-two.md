---
layout: post
title: "Writing a Ractor-based web server: part II"
date: 2020-12-27
comments: true
published: true
---

A few months ago I published a [post](/2020/09/08/ruby-ractor-web-server/){:target="\_blank"} about writing a simple web server in Ruby using Ractors. That took only 20 lines of code and it was able to leverage multiple CPUs with Ruby without having to go through the Global Interpreter Lock ([GIL](https://en.wikipedia.org/wiki/Global_interpreter_lock){:target="\_blank"}). That was a good preview to what the Ractor primitive is going to provide.

Since then Ruby 3.0 was released and the Ractor implementation has got more mature. In this post, we'll make our Ractor-based web server do more things.

By the end of the post, you'll learn the constraints of Ractors and get familiar with three PRs to MRI that I had to open to make it work.

## Getting started

Here's what we ended up with in the [previous post](/2020/09/08/ruby-ractor-web-server/){:target="\_blank"}:

```ruby
require 'socket'

pipe = Ractor.new do
  loop do
    Ractor.yield(Ractor.receive, move: true)
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

Our web server does not parse the incoming request and responds with the hardcoded `Hello world!` string. Let's make it more dynamic.

We'll leverage WEBrick, a simple web server that ships with Ruby, to parse HTTP requests. That should be as simple as:

```ruby
req = WEBrick::HTTPRequest.new(WEBrick::Config::HTTP)
req.parse(sock)

# req is the HTTPRequest object with all attributes populated by `parse`
```

Let's try it out:

```ruby
require 'webrick'

pipe = Ractor.new do
  loop do
    Ractor.yield(Ractor.receive, move: true)
  end
end

CPU_COUNT = 4
workers = CPU_COUNT.times.map do
  Ractor.new(pipe) do |pipe|
    loop do
      s = pipe.take

      req = WEBrick::HTTPRequest.new(WEBrick::Config::HTTP.merge(RequestTimeout: nil))
      req.parse(s)

      puts req.inspect

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
end
```

We'll see it fail with:

```
ractor_v0.rb:28:in `block (3 levels) in <main>': can not access non-shareable objects in constant WEBrick::Config::HTTP by non-main Ractor. (Ractor::IsolationError)
	from ractor_v0.rb:25:in `loop'
	from ractor_v0.rb:25:in `block (2 levels) in <main>'
```

Thankfully this is an easy fix: since `WEBrick::Config::HTTP` is not a frozen object, we need to explicitly freeze it and it make it shareable across Ractors.

We'll have to prepend our server's code with something like this:

```ruby
Ractor.make_shareable(WEBrick::Config::HTTP)
Ractor.make_shareable(WEBrick::LF)
Ractor.make_shareable(WEBrick::CRLF)
Ractor.make_shareable(WEBrick::HTTPRequest::BODY_CONTAINABLE_METHODS)
Ractor.make_shareable(WEBrick::HTTPStatus::StatusMessage)
```

I opened a [fix](https://github.com/ruby/webrick/pull/65){:target="\_blank"} upstream to make that work by default. On the way making the rest of the code work I've had to do the [same thing](https://github.com/ruby/ruby/pull/4008){:target="\_blank"} for the `Time` class too.

## The story of URI parsing

Once we declared those objects shareable, we'll see it fail with exceptions like:

```
/opt/rubies/3.0.0/lib/ruby/3.0.0/uri/common.rb:77:in `for': can not access class variables from non-main Ractors (Ractor::IsolationError)
	from /opt/rubies/3.0.0/lib/ruby/3.0.0/uri/rfc3986_parser.rb:72:in `parse'
	from /opt/rubies/3.0.0/lib/ruby/3.0.0/uri/common.rb:171:in `parse'
	from /Users/kir/.gem/ruby/3.0.0/gems/webrick-1.7.0/lib/webrick/httprequest.rb:504:in `parse_uri'
	from /Users/kir/.gem/ruby/3.0.0/gems/webrick-1.7.0/lib/webrick/httprequest.rb:218:in `parse'
```

We must remember that Ractors are [strict](https://github.com/ruby/ruby/blob/master/doc/ractor.md){:target="\_blank"} about the concurrent data access and class variables are not safe to read concurrently.

We could boil that error down to:

```ruby
r = Ractor.new do
  res = URI.parse("https://ruby-lang.org/")
  puts res.inspect
end
```

If we look up `URI` implementation we'll notice it [uses](https://github.com/ruby/ruby/blob/master/lib/uri/common.rb#L77){:target="\_blank"} a class instance variable:

```ruby
module URI
  # ...
  def self.for(scheme, *arguments, default: Generic)
    if scheme
      # @@schemes is the class instance variable
      uri_class = @@schemes[scheme.upcase] || default
    else
      uri_class = default
    end

    return uri_class.new(scheme, *arguments)
  end
```

There's nothing we can do to make that safe to access across multiple Ractors without changing the URI module's code. Here's [my PR](https://github.com/ruby/ruby/pull/4007){:target="\_blank"} with the attempted fix.

## Making it work

After those three changes from above we have the following code working:

```ruby
require 'webrick'

# Fix: https://github.com/ruby/webrick/pull/65
Ractor.make_shareable(WEBrick::Config::HTTP)
Ractor.make_shareable(WEBrick::LF)
Ractor.make_shareable(WEBrick::CRLF)
Ractor.make_shareable(WEBrick::HTTPRequest::BODY_CONTAINABLE_METHODS)
Ractor.make_shareable(WEBrick::HTTPStatus::StatusMessage)

# To pick up changes from https://github.com/ruby/ruby/pull/4007
Object.send(:remove_const, :URI)
require '/Users/kir/src/github.com/ruby/ruby/lib/uri.rb'

pipe = Ractor.new do
  loop do
    Ractor.yield(Ractor.receive, move: true)
  end
end

CPU_COUNT = 4
workers = CPU_COUNT.times.map do
  Ractor.new(pipe) do |pipe|
    loop do
      s = pipe.take

      req = WEBrick::HTTPRequest.new(WEBrick::Config::HTTP.merge(RequestTimeout: nil))
      req.parse(s)
      puts req.inspect

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
end
```

Yay! Now our server can parse HTTP protocol thanks to the parser from WEBrick.

## Serving Rack apps

All web apps in Ruby are using [Rack](https://github.com/rack/rack/){:target="\_blank"} as a modular interface to web servers. Let's make our server compatible with the Rack interface.

We can [peek](https://github.com/rack/rack/blob/5791ef617717d568dc3387cfd5db1c97f08455ca/lib/rack/handler/webrick.rb#L66){:target="\_blank"} into how Rack integrates with WEBrick and follow the same pattern. The `service` method is what we're interested in. It does three things:

1. [Take](https://github.com/rack/rack/blob/5791ef617717d568dc3387cfd5db1c97f08455ca/lib/rack/handler/webrick.rb#L68){:target="\_blank"} `WEBrick::HTTPRequest` as the input and transform it into Rack env
2. [Call](https://github.com/rack/rack/blob/5791ef617717d568dc3387cfd5db1c97f08455ca/lib/rack/handler/webrick.rb#L94){:target="\_blank"} the Rack app with that env
3. [Put](https://github.com/rack/rack/blob/5791ef617717d568dc3387cfd5db1c97f08455ca/lib/rack/handler/webrick.rb#L96-L116){:target="\_blank"} the response to `WEBrick::HTTPResponse`

We could borrow some of that code and make it work with something like this (see the [full version](https://gist.github.com/kirs/2dd4fcae9983df8b7b5b6c335b97f8e3){:target="\_blank"}):

```ruby
# has to be explicitly required from the main thread:
# https://bugs.ruby-lang.org/issues/17477
require 'pp'

def env_from_request(req)
  env = req.meta_vars
  env.delete_if { |k, v| v.nil? }

  rack_input = StringIO.new(req.body.to_s)
  rack_input.set_encoding(Encoding::BINARY)

  env.update(
    Rack::RACK_VERSION      => Rack::VERSION,
    Rack::RACK_INPUT        => rack_input,
    Rack::RACK_ERRORS       => $stderr,
    Rack::RACK_MULTITHREAD  => true,
    Rack::RACK_MULTIPROCESS => false,
    Rack::RACK_RUNONCE      => false,
    Rack::RACK_URL_SCHEME   => ["yes", "on", "1"].include?(env[Rack::HTTPS]) ? "https" : "http"
  )

  env[Rack::QUERY_STRING] ||= ""
  unless env[Rack::PATH_INFO] == ""
    path, n = req.request_uri.path, env[Rack::SCRIPT_NAME].length
    env[Rack::PATH_INFO] = path[n, path.length - n]
  end
  env[Rack::REQUEST_PATH] ||= [env[Rack::SCRIPT_NAME], env[Rack::PATH_INFO]].join
  env
end

CPU_COUNT = 4
workers = CPU_COUNT.times.map do
  Ractor.new(pipe) do |pipe|
    app = lambda do |e|
      [200, {'Content-Type' => 'text/html'}, ['hello world']]
    end

    loop do
      s = pipe.take

      req = WEBrick::HTTPRequest.new(WEBrick::Config::HTTP.merge(RequestTimeout: nil))
      req.parse(s)

      env = env_from_request(req)

      status, headers, body = app.call(env)

      resp = WEBrick::HTTPResponse.new(WEBrick::Config::HTTP)

      begin
        resp.status = status.to_i
        io_lambda = nil
        headers.each { |k, vs|
          if k.downcase == "set-cookie"
            resp.cookies.concat vs.split("\n")
          else
            # Since WEBrick won't accept repeated headers,
            # merge the values per RFC 1945 section 4.2.
            resp[k] = vs.split("\n").join(", ")
          end
        }

        body.each { |part|
          resp.body << part
        }
      ensure
        body.close  if body.respond_to? :close
      end

      pp env

      resp.send_response(s)
    end
  end
end
```

Now we have a tiny Rack app running on multiple CPUs powered by the Ractor primitive! This is huge because Ractor was nowhere there when I wrote the [first post](/2020/09/08/ruby-ractor-web-server/){:target="\_blank"}. By the Ruby 3.0 release it has matured to the point that we are able to integrate it with Rack with only a few patches.

## Wrap up

I hope this post gave some overview about the current state of the Ractor pattern in Ruby, to both developers and Ruby contributors.

If you are skimming over the post and are just curious about the internals, you can see the final version of the code [here](https://gist.github.com/kirs/2dd4fcae9983df8b7b5b6c335b97f8e3){:target="\_blank"}. Below is the list of all bugs/patches that I reported to the upstream as the result of the writing:

- [https://bugs.ruby-lang.org/issues/17477](https://bugs.ruby-lang.org/issues/17477){:target="\_blank"}
- [https://github.com/ruby/webrick/pull/65](https://github.com/ruby/webrick/pull/65){:target="\_blank"}
- [https://github.com/ruby/ruby/pull/4007](https://github.com/ruby/ruby/pull/4007){:target="\_blank"}
- [https://github.com/ruby/ruby/pull/4008](https://github.com/ruby/ruby/pull/4008){:target="\_blank"}
- [https://github.com/rack/rack/pull/1726](https://github.com/rack/rack/pull/1726){:target="\_blank"}

If you need a general refresher about Ractor, you should check out [ractor.md](https://github.com/ruby/ruby/blob/master/doc/ractor.md){:target="\_blank"} in the Ruby repo.

The next step would be to try making our server run Sinatra apps. In theory, Sinatra app is the same Rack app, but there's some global state in Sinatra and Rack that might make it more tricky.
