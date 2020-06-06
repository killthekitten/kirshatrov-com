---
layout: post
title: Finding a memory leak in a Go app with cgo bindings
date: 2019-11-04
comments: true
published: true
---

In this post, I'd like to share a story how my team was able to find and fix a memory leak in a Go app that's been using a leaking C extension through cgo.

Usually, finding a leak in Go apps is rather trivial thanks to the built-in profiling tool that comes with Go. `go tool pprof` with a minimum setup steps will show you all recent allocations and the overview of the memory heap. Our case turned out to be a lot more interesting.

At work, we have an internal service discovery application written in Go and backed by Zookeeper. Zookeeper is great as a distributed configuration store, but its protocol is quite complex, so we have a REST API wrapper in Go on top of it to make it easy to consume from other apps. This service discovery tool answers questions like "in which datacenter and region does a shop live?" or "to which region should we send a new shop?" or "what's the list of IPs that are bad citizens?".

The problem we've been seeing was that the memory consumed by the app has been growing unexpectedly fast. It would boot taking ~50Mb of RSS and then grow to >500Mb in a matter of hours until it was killed by container's OOM setting.

<img src="/assets/post-images/leak-before.png" style="margin: 0 auto;" />

This was a typical saw wave memory leak situation.

We could allow the container to take more memory and buy more time until it would get killed but that would only threat the symptom. We really wanted to figure out what was wrong with it.

The first thing to do was to add `import _ "net/http/pprof"` and attach to the profiling port. You could even do that to a production container in Kubernetes with `kubectl port-forward`!

However, attaching to a process with RSS of **hundreds of megabytes**, you could see Go's heap only being less than hundred of Mb. This meant that the memory was taken by something outside of the Go's VM. Go profiler would't be able to show any of that memory.

What could it be? We use [gozk](https://github.com/Shopify/gozk){:target="_blank"} as a Zookeeper client. gozk is using [cgo](https://golang.org/cmd/cgo/){:target="_blank"} to call out to libzookeeper, a C client for Zookeper.

Usually when there's C involved, there's a memory leak somewhere there. I saw a bunch of mallocs in gozk's code, not saying about the generated C code in `libzookeeper` that was even more tricky to follow.

I recently enjoyed reading Sam Saffron's [Debugging hidden memory leaks in Ruby](https://samsaffron.com/archive/2019/10/08/debugging-unmanaged-and-hidden-memory-leaks-in-ruby){:target="_blank"} blog post, where he mentioned [heaptrack](https://github.com/KDE/heaptrack){:target="_blank"} as something that could find leaks in C bindings.

It took my colleague Jared and I some time to get it working in a Debian container. In this app we used two stage Docker build to make the final container very light.

Our Dockerfile looked like this:

```
FROM golang:1.12-buster AS buildstage
go build -o /bin/appname

FROM debian:buster-slim

COPY --from=buildstage /bin/appname /bin/appname
ENTRYPOINT ["/bin/appname"]
```

heaptrack needed the actual Go tooling to inspect the process, so we've had to remove the two stage build optimization:

```
FROM golang:1.12-buster
go build -o /bin/appname
ENTRYPOINT ["/bin/appname"]
```

When we were finally able to run `heaptrack`, it didn't work due some syntax errors:

```
$ heaptrack --pid 12

heaptrack output will be written to "/go/heaptrack.magellan.578.gz"
injecting heaptrack into application via GDB, this might take some time...
warning: File "/usr/local/go/src/runtime/runtime-gdb.py" auto-loading has been declined by your `auto-load safe-path' set to "$debugdir:$datadir/auto-load".
A syntax error in expression, near `) __libc_dlopen_mode("/usr/lib/heaptrack/libheaptrack_inject.so", 0x80000000 | 0x002)'.
A syntax error in expression, near `) heaptrack_inject("/tmp/heaptrack_fifo578")'.
injection finished
```

I was able to [trace](https://github.com/KDE/heaptrack/blob/2d14f5de75b9dae33be0e782bcec043794e3f5e7/src/track/heaptrack.sh.cmake#L256){:target="_blank"} where that happens but at this point I've lacked the knowledge in heapstack itself to fix those syntax errors. I went to search for another tool.

I then asked my friend [Javier Honduco](http://twitter.com/javierhonduco){:target="_blank"} what tool he'd use to find a leak in C code binded to an app in a higher level language (this could even be Ruby instead of Go). He suggested few options:

* [https://clang.llvm.org/docs/LeakSanitizer.html](https://clang.llvm.org/docs/LeakSanitizer.html){:target="_blank"}
* [https://github.com/iovisor/bcc/blob/master/tools/memleak.py](https://github.com/iovisor/bcc/blob/master/tools/memleak.py){:target="_blank"}
* [https://github.com/jemalloc/jemalloc/wiki/Use-Case:-Leak-Checking](https://github.com/jemalloc/jemalloc/wiki/Use-Case:-Leak-Checking){:target="_blank"}

Replacing `malloc` with `jemalloc` which has leak checking features looked like an easy option, but I wasn't sure how that would play with `cgo`. I always heard how powerful BPF-based tools are, so I decided to give a try to `iovisor/bcc` and `memleak.py`.

Here's what I get from `memleak` when I attached it to my PID:

```
$ memleak-bpfcc -p 3584581
Attaching to pid 3584581, Ctrl+C to quit.
[12:22:50] Top 10 stacks with outstanding allocations:
    0 bytes in 1228 allocations from stack
        [unknown] [libzookeeper_mt.so.2.0.0]
        [unknown]
    24 bytes in 1 allocations from stack
        [unknown] [libzookeeper_mt.so.2.0.0]
        [unknown]
    256 bytes in 2 allocations from stack
        [unknown] [libzookeeper_mt.so.2.0.0]
```

The stacktrace wasn't very informative, but I learned that it was definitely something to do with the C part and zookeeper!

Someone told me that my build must have had missing debugging symbols which is why the stacktrace was missing exact lines.

To make sure that everything included debugging symbols, I've had to rewrite my Dockerfile from the above.

Instead of installing `libzookeeper` from a deb package, I ended up building it myself to be able to pass `--enable-debug` flag to `make`.

```
RUN curl -o zk.tar.gz https://archive.apache.org/dist/zookeeper/zookeeper-3.4.14/zookeeper-3.4.14.tar.gz && tar -xf zk.tar.gz && cd zookeeper-3.4.14/zookeeper-client/zookeeper-client-c && ./configure --enable-debug && make && make install && ldconfig
```

There's been to mention that I wasn't able to build it on a slim container even after installing a few extra packages. I took `ubuntu:bionic` as a base and installed Go myself:

```bash
FROM ubuntu:bionic

RUN apt-get update && apt-get install -y curl build-essential

RUN curl -sSL https://storage.googleapis.com/golang/go1.12.5.linux-amd64.tar.gz \
  | tar -C /usr/local -xz
ENV PATH /usr/local/go/bin:$PATH
RUN mkdir -p /go/src /go/bin && chmod -R 777 /go
ENV GOROOT /usr/local/go
ENV GOPATH /go
ENV PATH /go/bin:$PATH
WORKDIR /go

# ZK
RUN curl -o zk.tar.gz https://archive.apache.org/dist/zookeeper/zookeeper-3.4.14/zookeeper-3.4.14.tar.gz && tar -xf zk.tar.gz && cd zookeeper-3.4.14/zookeeper-client/zookeeper-client-c && ./configure --enable-debug && make && make install && ldconfig
```

This took me a couple hours to make it work, and now I was able to grab the full trace of the leak:

```bash
# use interval of 30 seconds and prune any allocations newer than 5000ms
$ memleak-bpfcc -p 1174052 -o 5000 30
Attaching to pid 1174052, Ctrl+C to quit.
[17:34:55] Top 10 stacks with outstanding allocations:
    0 bytes in 6261 allocations from stack
        deserialize_String_vector+0x4c [libzookeeper_mt.so.2.0.0]
        deserialize_GetChildren2Response+0x4b [libzookeeper_mt.so.2.0.0]
        process_sync_completion+0x27e [libzookeeper_mt.so.2.0.0]
        zookeeper_process+0x5e7 [libzookeeper_mt.so.2.0.0]
        do_io+0x277 [libzookeeper_mt.so.2.0.0]
        start_thread+0xdb [libpthread-2.27.so]
```

I was amazed by how much debugging symbols make the difference.

With this data, it was now possible to trace it to actual C functions and try to find the suspicious part. That's when the rest of the team (Scott and Hormoz, who had more experience with C) came into action.

Now that there was a pointer where to look at, Scott was able to read the potentially leaking code and come up with the [fix](https://github.com/Shopify/gozk/pull/4){:target="_blank"}. I won't try to rephrase it here, so please read the PR, it's a great write-up!

It was an amazing moment when we canaried the fix and found how much impact it had:

<img src="/assets/post-images/leak-after.png" style="margin: 0 auto;" />

---

As you can see, it took us couple failures (with `go tool profile` and `heapstack`) until we found a tool that allowed us to pin the issue. I was close to surrending and not continue to explore this. I hope this will motivate others and give a faith that any issue can be fixed if you spend enough time looking at problem from different angles.

I'd like to say thanks to all people who've worked on finding this leak: Jared, Forrest, Hormoz, Tai, Scott, and Dale. There wouldn't be this post if all these people wouldn't put efforts to address the leak. And of course Javier who've suggested the veriety of tools that I could try.

If you're keen to learn more tools, I was recommended the [BPF Performance Tools](http://www.brendangregg.com/bpf-performance-tools-book.html){:target="_blank"} book that covers a lot more topics on Linux observability than just memory.

If you have any other ideas how you'd approach the problem and what other tool you'd try, please let me know in comments!
