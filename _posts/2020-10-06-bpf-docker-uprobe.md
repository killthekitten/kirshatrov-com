---
layout: post
title: "bpftrace, uprobe and containers"
date: 2020-10-06
comments: true
published: true
---

Couple days ago at work I found myself needing to trace [BPF's _uprobes_](https://github.com/iovisor/bcc/blob/master/docs/reference_guide.md#4-uprobes){:target="_blank"} while investigating an issue with `libzookeeper`.

Normally, running a `uprobe` / `uretprobe` is as easy as passing the path to the library and the function name:

```
$ bpftrace -e 'uretprobe:/usr/lib/x86_64-linux-gnu/libzookeeper_mt.so.2.0.0:zoo_set2 { printf("%d\n", retval); }'
```

In my case, Zookeeper client was running in a container. How do I figure out the path to the library if the process is in Docker?

Turns out it's not too hard, but I tend to forget things, so I decided to write this post for myself in the future in case I need to do this again.

---

**UPD (2020/11/25): there's an easier way to do this! Scroll down the post to see it.** I left the original steps in the post for a historical reference.

First, let's get container's ID:

```
$ docker ps | grep zookeeper
7c029e58e434        zookeeper           "/docker-entrypoint.…"   About a minute ago   Up About a minute   2181/tcp, 2888/tcp, 3888/tcp, 8080/tcp   relaxed_dewdney
```

`7c029e58e434` is the container ID. Now let's inspect it:

```
$ docker inspect 7c029e58e434 | grep overlay
  "Driver": "overlay2",
    "LowerDir": "/var/lib/docker/overlay2/a40fd6684803e3cc28c9f69bf948433a12b791916fca3b5c50914e8afb712ef5-init/diff:/var/lib/docker/overlay2/14b0cf5b7bd1d4b8663ba15b1fe6fa56cf53ce8c5e86cc1e69f9bb029df26d24/diff:/var/lib/docker/overlay2/fe8d13983650f04e8c399eb68b570777e48d1d7f05357563430e416350159aad/diff:/var/lib/docker/overlay2/92fff12f8e25a5d463888e9f60b6a3972875f9d7a05156d84e999f6b16d523a5/diff:/var/lib/docker/overlay2/dba58c50dcf82bcf10b3ee9875dc341c48f422d54c4c9dd13a5d8d3383c35c52/diff:/var/lib/docker/overlay2/be196b7d95ad1adcb165cfff35bb5fde8f4e713dcb3bee51cc1bb226e94d39b1/diff:/var/lib/docker/overlay2/ae7d7d5ae29516fffcd80a39b64365356904e90fd2bf49e005c31418cb196126/diff:/var/lib/docker/overlay2/e241bfd12dcaadf4bb927cdfd0a34da11d9972b8fa12860a0588bd51287173f8/diff:/var/lib/docker/overlay2/0f7ec7ebb8f524c16c9cfa687daee058c955c34c7f26ded530f3644c6f7520e3/diff",
    "MergedDir": "/var/lib/docker/overlay2/a40fd6684803e3cc28c9f69bf948433a12b791916fca3b5c50914e8afb712ef5/merged",
    "UpperDir": "/var/lib/docker/overlay2/a40fd6684803e3cc28c9f69bf948433a12b791916fca3b5c50914e8afb712ef5/diff",
    "WorkDir": "/var/lib/docker/overlay2/a40fd6684803e3cc28c9f69bf948433a12b791916fca3b5c50914e8afb712ef5/work"
  "Name": "overlay2"
```

[Overlay](https://www.kernel.org/doc/Documentation/filesystems/overlayfs.txt){:target="_blank"} is the magical layer-based filesystem that backs Docker layers. `MergedDir` (== `/var/lib/docker/overlay2/a40fd6684803e3cc28c9f69bf948433a12b791916fca3b5c50914e8afb712ef5/merged`) is what we're interested in. That's the directory with the container's filesystem.

If we know that the library is located in `/usr/lib/x86_64-linux-gnu/libzookeeper_mt.so.2.0.0` inside the container, we can combine that with `MergedDir` and check if that path exists:

```
$ stat /var/lib/docker/overlay2/a40fd6684803e3cc28c9f69bf948433a12b791916fca3b5c50914e8afb712ef5/merged/usr/lib/x86_64-linux-gnu/libzookeeper_mt.so.2.0.0
  File: /var/lib/docker/overlay2/a40fd6684803e3cc28c9f69bf948433a12b791916fca3b5c50914e8afb712ef5/merged/usr/lib/x86_64-linux-gnu/libzookeeper_mt.so.2.0.0
  Size: 109680    	Blocks: 216        IO Block: 4096   regular file
Device: 300016h/3145750d	Inode: 15295626    Links: 1
Access: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)
Access: 2019-06-05 04:22:04.000000000 +0000
Modify: 2019-06-05 04:22:04.000000000 +0000
Change: 2020-10-03 21:28:44.754400357 +0000
 Birth: -
```

It exists! Now we can pass that as a path to `bpftrace`:

```
$ bpftrace -e 'uretprobe:/var/lib/docker/overlay2/a40fd6684803e3cc28c9f69bf948433a12b791916fca3b5c50914e8afb712ef5/merged/usr/lib/x86_64-linux-gnu/libzookeeper_mt.so.2.0.0:zoo_set2 { printf("%d\n", retval); }'
Attaching 1 probe...
0
-4
-4
^C
```

**UPD (2020/11/25): as suggested by Dale Hamel, there's an easier way to do all of this!**

We still need to grab container's PID with `docker inspect`:

```bash
# ab31c58d2d03 is container ID from docker ps
$ docker inspect ab31c58d2d03 | grep -m1 Pid
            "Pid": 1922,
```

And then we point `bpftrace` to the filesystem of that PID, which [maps](https://man7.org/linux/man-pages/man5/proc.5.html) to `/proc/<PID>/root`:

```
$ bpftrace -e 'uretprobe:/proc/<CONTAINER-PID>/root/usr/lib/x86_64-linux-gnu/libzookeeper_mt.so.2.0.0:zoo_set2 { printf("%d\n", retval); }'
```

If you access the filesystem through this path though, it should be the view of the mount namespace as seen by that given process.

An alternative to the way above would be passing `-p` to `bpftrace`:

```
$ bpftrace -p <CONTAINER-PID> -e 'uretprobe:/usr/lib/x86_64-linux-gnu/libzookeeper_mt.so.2.0.0:zoo_set2 { printf("%d\n", retval); }'
```

Much cleaner than having to overlay path around.

---

In my case, uprobes me helped to find out that from time to time, `zoo_set2` returns `-4` which is an error code.

Note that I was running `bpftrace` from the host &ndash; thanks to the [COS toolbox](https://cloud.google.com/container-optimized-os/docs/how-to/toolbox){:target="_blank"}, BPF tools were pre-installed there. Another option would be to install `bpftrace` right into my container. In that case I wouldn't need to lookup overlay paths and `MergedDir`. But from my experience, installing `bpftrace` into a container would take more time than these extra steps required to run it from the host, which is why I prefered this approach.
