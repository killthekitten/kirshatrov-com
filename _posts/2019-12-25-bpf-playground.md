---
layout: post
title: Playing with BPF
date: 2019-12-25
comments: true
published: true
---

I've been taking some time to study the [BPF Performance Tools](http://www.brendangregg.com/bpf-performance-tools-book.html){:target="_blank"} book by Brendan Gregg.

There's a been a lot of partial resources and tips about using BPF, and it has already helped me to find an epic [memory leak](/2019/11/04/finding-memory-leak-in-cgo/){:target="_blank"}. I always wanted to get a chance to learn it deeper and the release of Gregg's book was a good cause. My colleague from Shopify's ProdEng team Dale Hamel helped to review the book too, which only pumped my interest about the technology.

When it comes to observability, the most impact (IMO) from being able to trace something really quickly and find the root cause is during incidents, when it's not clear what's happening and pulling the right observability tool from your hat is the top skill. That's the muscle that I'd want to extract from the book, and writing notes in "what I've learned" format will hopefully help.

This post is a collection of notes taken while getting my hands dirty with each of the tools, as the book goes.

## 0. Getting bpfcc-tools ready

Turns out that `apt-get install bpfcc-tools` on Ubuntu 18.04 Bionic is broken, as I'm writing this in December 2019. Thankfully it's fixed in the upstream, and I [documented](https://github.com/iovisor/bcc/issues/2119#issuecomment-568455415){:target="_blank"} steps how to install a nightly package.

## 1. execsnoop

`execsnoop` prints all processes that were launched (aka trace `exec()` syscalls). In the real life, it might come handy to inspect external calls coming from the application server (for instance, `imagemagick`).

Steps I've taken:

1. Open a terminal tab, SSH to the devbox, run `sudo /usr/share/bcc/tools/execsnoop`

2. SSH to the same VM from another terminal tab, observe `execsnoop` in tab 1) printing all the commands that were executed during the login:

```
PCOMM            PID    PPID   RET ARGS
sshd             5429   1430     0 /usr/sbin/sshd -D -R
sh               5431   5429     0
env              5432   5431     0 /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin run-parts --lsbsysinit /etc/update-motd.d
run-parts        5432   5431     0 /bin/run-parts --lsbsysinit /etc/update-motd.d
00-header        5433   5432     0 /etc/update-motd.d/00-header
uname            5434   5433     0 /bin/uname -o
uname            5435   5433     0 /bin/uname -r
uname            5436   5433     0 /bin/uname -m
10-help-text     5437   5432     0 /etc/update-motd.d/10-help-text
50-landscape-sy  5438   5432     0 /etc/update-motd.d/50-landscape-sysinfo
grep             5439   5438     0 /bin/grep -c ^processor /proc/cpuinfo
cut              5443   5441     0 /usr/bin/cut -f1 -d   /proc/loadavg
bc               5442   5440     0 /usr/bin/bc
date             5444   5438     0 /bin/date
landscape-sysin  5445   5438     0 /usr/bin/landscape-sysinfo
ldconfig         5446   5445     0 /sbin/ldconfig -p
ldconfig.real    5446   5445     0 /sbin/ldconfig.real -p
ldconfig         5447   5445     0 /sbin/ldconfig -p
ldconfig.real    5447   5445     0 /sbin/ldconfig.real -p
who              5449   5445     0 /usr/bin/who -q
50-motd-news     5450   5432     0 /etc/update-motd.d/50-motd-news
cat              5451   5450     0 /bin/cat /var/cache/motd-news
tr               5453   5450     0 /usr/bin/tr -d \000-\011\013\014\016-\037
head             5452   5450     0 /usr/bin/head -n 10
cut              5454   5450     0 /usr/bin/cut -c -80
80-esm           5455   5432     0 /etc/update-motd.d/80-esm
lsb_release      5456   5455     0 /usr/bin/lsb_release -cs
lsb_release      5457   5455     0 /usr/bin/lsb_release -ds
80-livepatch     5458   5432     0 /etc/update-motd.d/80-livepatch
90-updates-avai  5459   5432     0 /etc/update-motd.d/90-updates-available
cat              5460   5459     0 /bin/cat /var/lib/update-notifier/updates-available
91-release-upgr  5461   5432     0 /etc/update-motd.d/91-release-upgrade
cut              5464   5462     0 /usr/bin/cut -d  -f4
lsb_release      5463   5462     0 /usr/bin/lsb_release -sd
release-upgrade  5461   5432     0 /usr/lib/ubuntu-release-upgrader/release-upgrade-motd
date             5465   5461     0 /bin/date +%s
stat             5466   5461     0 /usr/bin/stat -c %Y /var/lib/ubuntu-release-upgrader/release-upgrade-available
expr             5467   5461     0 /usr/bin/expr 1577101965 + 86400
95-hwe-eol       5468   5432     0 /etc/update-motd.d/95-hwe-eol
update-motd-hwe  5468   5432     0 /usr/lib/update-notifier/update-motd-hwe-eol
apt-config       5469   5468     0 /usr/bin/apt-config shell StateDir Dir::State
dpkg             5470   5469     0 /usr/bin/dpkg --print-foreign-architectures
apt-config       5471   5468     0 /usr/bin/apt-config shell ListDir Dir::State::Lists
dpkg             5472   5471     0 /usr/bin/dpkg --print-foreign-architectures
apt-config       5473   5468     0 /usr/bin/apt-config shell DpkgStatus Dir::State::status
dpkg             5474   5473     0 /usr/bin/dpkg --print-foreign-architectures
apt-config       5475   5468     0 /usr/bin/apt-config shell EtcDir Dir::Etc
dpkg             5476   5475     0 /usr/bin/dpkg --print-foreign-architectures
apt-config       5477   5468     0 /usr/bin/apt-config shell SourceList Dir::Etc::sourcelist
dpkg             5478   5477     0 /usr/bin/dpkg --print-foreign-architectures
find             5479   5468     0 /usr/bin/find /var/lib/apt/lists/ /etc/apt/sources.list //var/lib/dpkg/status -type f -newer /var/lib/update-notifier/hwe-eol -print -quit
dirname          5481   5480     0 /usr/bin/dirname /var/lib/update-notifier/hwe-eol
mktemp           5480   5468     0 /bin/mktemp -p /var/lib/update-notifier
cat              5482   5468     0 /bin/cat /var/lib/update-notifier/hwe-eol
rm               5483   5468     0 /bin/rm -f /var/lib/update-notifier/tmp.RjVbtK5reS
97-overlayroot   5484   5432     0 /etc/update-motd.d/97-overlayroot
egrep            5486   5485     0 /bin/egrep overlayroot|/media/root-ro|/media/root-rw /proc/mounts
sort             5487   5485     0 /usr/bin/sort -r
grep             5486   5485     0 /bin/grep -E overlayroot|/media/root-ro|/media/root-rw /proc/mounts
98-fsck-at-rebo  5488   5432     0 /etc/update-motd.d/98-fsck-at-reboot
update-motd-fsc  5488   5432     0 /usr/lib/update-notifier/update-motd-fsck-at-reboot
stat             5489   5488     0 /usr/bin/stat -c %Y /var/lib/update-notifier/fsck-at-reboot
awk              5491   5490     0 /usr/bin/awk {print $1} /proc/uptime
date             5490   5488     0 /bin/date -d now - 1614.44 seconds +%s
date             5492   5488     0 /bin/date +%s
cat              5493   5488     0 /bin/cat /var/lib/update-notifier/fsck-at-reboot
98-reboot-requi  5494   5432     0 /etc/update-motd.d/98-reboot-required
update-motd-reb  5494   5432     0 /usr/lib/update-notifier/update-motd-reboot-required
bash             5496   5495     0 /bin/bash
groups           5498   5497     0 /usr/bin/groups
locale-check     5500   5499     0 /usr/bin/locale-check C.UTF-8
locale           5501   5496     0 /usr/bin/locale
lesspipe         5504   5503     0 /usr/bin/lesspipe
basename         5505   5504     0 /usr/bin/basename /usr/bin/lesspipe
dirname          5507   5506     0 /usr/bin/dirname /usr/bin/lesspipe
dircolors        5509   5508     0 /usr/bin/dircolors -b
```

Turns out there's a lot of stuff involved when you ssh and login into a terminal session.

## 2. biolatency

`biolatency` prints stats about I/O latency as a diagram. In the past, I've seen my colleagues using it to debug slow disks in cloud, which might be especially critical for latency-sensitive workloads like DBs.

Steps I've taken:

1. Install `fio` (I/O tester) on a VM with standard disk (`pd-standard` on Google Cloud) and run a sample test:

    ```
    $ fio --randrepeat=1 --ioengine=libaio --direct=1 --gtod_reduce=1 --name=test --filename=random_read_write.fio --bs=4k --iodepth=64 --size=4G --readwrite=randrw --rwmixread=75
    ```

2. Run `biolatency` in another tab:

```
$ sudo /usr/share/bcc/tools/biolatency -D
Tracing block device I/O... Hit Ctrl-C to end.
^C

disk = 'sda'
     usecs               : count     distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 0        |                                        |
         4 -> 7          : 0        |                                        |
         8 -> 15         : 0        |                                        |
        16 -> 31         : 1        |                                        |
        32 -> 63         : 14       |                                        |
        64 -> 127        : 7        |                                        |
       128 -> 255        : 1        |                                        |
       256 -> 511        : 0        |                                        |
       512 -> 1023       : 8        |                                        |
      1024 -> 2047       : 9        |                                        |
      2048 -> 4095       : 30       |                                        |
      4096 -> 8191       : 49       |                                        |
      8192 -> 16383      : 172      |                                        |
     16384 -> 32767      : 298      |*                                       |
     32768 -> 65535      : 395      |*                                       |
     65536 -> 131071     : 758      |***                                     |
    131072 -> 262143     : 1290     |*****                                   |
    262144 -> 524287     : 9138     |****************************************|
```

The latency seems pretty high!

3. Provision another VM with a local SSD and re-run the command:

```
disk = 'nvme0n1'
     usecs               : count     distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 0        |                                        |
         4 -> 7          : 0        |                                        |
         8 -> 15         : 0        |                                        |
        16 -> 31         : 0        |                                        |
        32 -> 63         : 47812    |****                                    |
        64 -> 127        : 171016   |***************                         |
       128 -> 255        : 448958   |****************************************|
       256 -> 511        : 136858   |************                            |
       512 -> 1023       : 50191    |****                                    |
      1024 -> 2047       : 69666    |******                                  |
      2048 -> 4095       : 57147    |*****                                   |
      4096 -> 8191       : 7615     |                                        |
      8192 -> 16383      : 246      |                                        |
     16384 -> 32767      : 47       |                                        |
     32768 -> 65535      : 41       |                                        |
     65536 -> 131071     : 120      |                                        |
    131072 -> 262143     : 298      |                                        |
    262144 -> 524287     : 511      |                                        |
    524288 -> 1048575    : 1263     |                                        |
   1048576 -> 2097151    : 1658     |                                        |
   2097152 -> 4194303    : 152      |                                        |
```

As expected, switching to SSD gives much lower latency.

# 3. opensnoop

`opensnoop` traces all files that were open on the system (aka trace `open()` syscalls).

Steps I've taken:

1. In one tab, run `sudo /usr/share/bcc/tools/opensnoop` (optionally pass `-n` to scope it to a specific app)
2. In another tab, run some user app (in my case it was ProxySQL since I've already had it compiled on that devbox)
3. Observe files that ProxySQL attempted to open:

```
$ sudo /usr/share/bcc/tools/opensnoop -n proxysql

PID    COMM               FD ERR PATH
2470   proxysql            3   0 /etc/ld.so.cache
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libgnutls.so.30
2470   proxysql            3   0 /lib/x86_64-linux-gnu/libpthread.so.0
2470   proxysql            3   0 /lib/x86_64-linux-gnu/librt.so.1
2470   proxysql            3   0 /lib/x86_64-linux-gnu/libdl.so.2
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libstdc++.so.6
2470   proxysql            3   0 /lib/x86_64-linux-gnu/libm.so.6
2470   proxysql            3   0 /lib/x86_64-linux-gnu/libgcc_s.so.1
2470   proxysql            3   0 /lib/x86_64-linux-gnu/libc.so.6
2470   proxysql            3   0 /lib/x86_64-linux-gnu/libz.so.1
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libp11-kit.so.0
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libidn2.so.0
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libunistring.so.2
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libtasn1.so.6
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libnettle.so.6
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libhogweed.so.4
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libgmp.so.10
2470   proxysql            3   0 /usr/lib/x86_64-linux-gnu/libffi.so.6
2470   proxysql            3   0 /proc/sys/vm/overcommit_memory
2470   proxysql            3   0 /sys/kernel/mm/transparent_hugepage/enabled
2470   proxysql            3   0 /etc/nsswitch.conf
2470   proxysql            3   0 /etc/ld.so.cache
2470   proxysql           -1   2 /lib/x86_64-linux-gnu/tls/x86_64/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64-linux-gnu/tls/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64-linux-gnu/tls/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64-linux-gnu/tls/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64-linux-gnu/x86_64/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64-linux-gnu/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64-linux-gnu/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64-linux-gnu/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64-linux-gnu/tls/x86_64/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64-linux-gnu/tls/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64-linux-gnu/tls/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64-linux-gnu/tls/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64-linux-gnu/x86_64/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64-linux-gnu/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64-linux-gnu/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64-linux-gnu/libnss_db.so.2
2470   proxysql           -1   2 /lib/tls/x86_64/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/tls/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/tls/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/tls/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /lib/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/tls/x86_64/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/tls/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/tls/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/tls/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/x86_64/libnss_db.so.2
2470   proxysql           -1   2 /usr/lib/libnss_db.so.2
2470   proxysql            3   0 /etc/ld.so.cache
2470   proxysql            3   0 /lib/x86_64-linux-gnu/libnss_files.so.2
2470   proxysql            3   0 /etc/services
2470   proxysql           -1   2 /usr/local/ssl/openssl.cnf
2470   proxysql            3   0 /etc/localtime
2470   proxysql            3   0 /dev/urandom
2470   proxysql            3   0 /home/kir/proxysql-key.pem
2470   proxysql            3   0 /home/kir/proxysql-cert.pem
2470   proxysql            3   0 /usr/bin/proxysql
2470   proxysql            4   0 /home/kir/proxysql.pid
```

Under the hood, `opensnoop` is just a fancy wrapper around `sudo bpftrace -e 'tracepoint:syscalls:sys_enter_open*`.

However, tracing `open()` syscalls only shows files that were opened, but not files that were attempted to open but didn't exist. This might come useful if you want to trace an app that's failing due some config file that doesn't exist.

A common scanerio could be:

```ruby
if File.exist?(path/to/config)
  File.open(path/to/config)
else
  # some other behaviour
end
```

In my case, it was ProxySQL failing to start because it couldn't find the config file:

```
$ proxysql
2019-12-25 18:26:58 main.cpp:829:ProxySQL_Main_process_global_variables(): [WARNING] Unable to open config file /etc/proxysql.cnf
[Warning]: Cannot open any default config file . Using default datadir in current working directory /home/kir
...
```

Let's find a syscall that attempts (and fails) to read `/etc/proxysql.cnf`. From what I found, it's the `access` syscall that is used to check for file existance. It was easy enough to come up with a BPF instruction.


```
$ sudo bpftrace -e 'tracepoint:syscalls:sys_enter_access { printf("%s %s\n", comm, str
Attaching 1 probe...
proxysql /etc/ld.so.preload
proxysql /etc/proxysql.cnf
proxysql /home/kir/proxysql-key.pem
proxysql /home/kir/proxysql-cert.pem
proxysql /home/kir/proxysql-ca.pem
```

Also at this point, I've started to peak and learn syntax for `bpftrace`, as opposed to user-friendly tools around it like `opensnoop`.

Maybe I could even find the stacktrace?

```
$ sudo bpftrace -e 'tracepoint:syscalls:sys_enter_access { printf("%s %s %s\n", comm, str(args->filename), ustack); }'
Attaching 1 probe...
proxysql /etc/ld.so.preload
        0x7f4cdaf6e9d7
        0x7f4cdaf6c9ef
        0x40

proxysql /etc/proxysql.cnf
        access+7
        0x6e632e6c71737978
...
```

Not much info from the stack trace anyways. Debugging symbols must be missing. Let's try to recompile ProxySQL with `make debug`:

```
$ sudo bpftrace -e 'tracepoint:syscalls:sys_enter_access { printf("%s %s %s\n", comm, str(args->filename), ustack); }'
proxysql /etc/ld.so.preload
        0x7f95ff32f9d7
        0x7f95ff32d9ef
        0x40

proxysql /etc/proxysql.cnf
        0x7f95fed0a0e7
        _ZN19ProxySQL_ConfigFile8OpenFileEPKc+94
        _Z38ProxySQL_Main_process_global_variablesiPPKc+125
        main+115
        0x7f95fec23b6b
        0x41fd89415541f689
```

Yay! Now we can know that it's the `ProxySQL_ConfigFile8OpenFileEPK` function that checks for existance of `/etc/proxysql.cnf` using `access()` syscall.

## Inspecting failed DNS queries

I wanted to play more with the raw `bpftrace -e` and I came up with an actual problem from production that would be interesting to debug.
At work, I observed a tiny percentage of RPCs failing due DNS lookups timing out. I don't have an idea yet why that might be happening, but with BPF I could at least observe those events better.

DNS resolution is done by `getaddrinfo(3)`. I found [gethostlatency.bt](https://github.com/iovisor/bpftrace/blob/master/tools/gethostlatency.bt){:target="_blank"} in bpftrace samples code which observes DNS resolution latency - something close to my case.

Here is the gist of it:

```
uprobe:/lib/x86_64-linux-gnu/libc.so.6:getaddrinfo,
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname,
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname2
{
	@start[tid] = nsecs;
	@name[tid] = arg0;
}

uretprobe:/lib/x86_64-linux-gnu/libc.so.6:getaddrinfo,
uretprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname,
uretprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname2
/@start[tid]/
{
	$latms = (nsecs - @start[tid]) / 1000000;
	time("%H:%M:%S  ");
	printf("%-6d %-16s %6d %s\n", pid, comm, $latms, str(@name[tid]));
	delete(@start[tid]);
	delete(@name[tid]);
}
```

The way I understand it, it does the following:

1. Capture the start of a user-land probe `getaddrinfo/gethostbyname/gethostbyname2`
2. Record the timestamp and the host
3. Capture the end of `getaddrinfo/gethostbyname/gethostbyname2` probe
4. Print the summary about the trace, including the delta of timestamps

What I'm looking for, is to only print _failed_ DNS lookups. Luckily, the end capture (`uretprobe`) contains the `retval` (return value) field. According to `getaddrinfo(3)` docs, non-zero return code means it failed. Let's filter by that:

```
BEGIN
{
        printf("Tracing getaddr/gethost calls... Hit Ctrl-C to end.\n");
        printf("%-9s %-6s %-16s %6s %s\n", "TIME", "PID", "COMM", "LATms",
            "HOST");
}

uprobe:/lib/x86_64-linux-gnu/libc.so.6:getaddrinfo,
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname,
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname2
{
        @name[tid] = arg0;
}

uretprobe:/lib/x86_64-linux-gnu/libc.so.6:getaddrinfo,
uretprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname,
uretprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname2
{
        if (retval != 0 ) { // for some reason retval < 0 didn't work in if statement
                time("%H:%M:%S  ");
                printf("failed | %-6d %-16s (error: %d) %s\n", pid, comm, retval, str(@name[tid]));
        };
        delete(@name[tid]);
}
```

Now, how do I locally reproduce a failing DNS lookup? The way to [stub](https://gist.github.com/kirs/5f711099b23ddae7a87ebb082ce43f59){:target="_blank"} that I've learned earlier it is to point resolv to a non-existing DNS server:

```bash
// find your original DNS server
$ cat /etc/resolv.conf |grep -i '^nameserver'|head -n1|cut -d ' ' -f2

// to take DNS down and point it to 127.0.0.1:
$ echo "$(sed 's/<your-original-DNS-server>/127.0.0.1/g' /etc/resolv.conf)" > /etc/resolv.conf

// to take DNS back up:
$ echo "$(sed 's/127.0.0.1/<your-original-DNS-server>/g' /etc/resolv.conf)" > /etc/resolv.conf
```

Now, with the probe running, we can try to hit `curl google.com` (which will fail on name lookup) and see the following output from `bpftrace`:

```
20:28:19  failed | 24087  curl             (error -3) google.com
```

Hurray!

There's probably another story for how to long-run that safely in production environment, which I'm yet to learn.

***

These are my notes for what I've learned so far from the BPF book, and I'm only 1/4 way through. Let's see what the rest of the book brings.

The goal of publishing this is mostly for me to be able to come back and revisit some steps from what I've documented, but I hope it could be useful for others too.

I'm eager to learn if there's anything here that I misunderstood or something that could be done better - please feel free to contact me on Twitter and point it out.

Also, thanks to my friend Javier Honduco for walking me over and explaining some of those things I've learned.
