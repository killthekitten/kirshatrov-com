---
layout: post
title: "Vitess: Scaling VReplication"
date: 2021-07-27
comments: true
published: true
---

One of my projects at work has been involving Vitess and VReplication. I recently did a deep dive to figure out how VReplication works and where are its scalability bottlenecks. Below are my notes that I thought are worth sharing with the community.

**What is VReplication?** To sum its [docs](https://vitess.io/docs/reference/vreplication/vreplication/#exec){:target="\_blank"}, it’s a tool that lets you copy and maintain a live subset of data from one database to another &ndash; similar to Shopify’s [Ghostferry](https://github.com/Shopify/ghostferry){:target="\_blank"}, but tailored for the Vitess’s world and with an orchestration layer on top of it.

VReplication is a core component of Vitess that backs many of its features, but where does its code actually run?

* Whenever you create a VReplication stream by executing a SQL statement like `INSERT INTO _vt.vreplication (db_name, source, pos, ...)`, VTTablet that is the **destination** of the stream will create multiple goroutines per each stream:

* A goroutine to manage the stream. This one will stop replication if you update the stream state to “Stopped” externally

* A goroutine to fetch binlog events from source over GRPC

* A goroutine to apply fetched binlog events

* A few goroutines to manage HTTP2/GRPC connection

* [Full dump of goroutines](https://gist.github.com/kirs/374acae18989ebf4e4a45fd7dff3b28f){:target="\_blank"}

With 152 streams running on a single VTTablet, I observed 11 goroutines running per a stream, making it 1672 goroutines to manage 152 streams.

VTTablet’s Go process on the destination side of the stream will eventually become a **bottleneck to run more streams than a single Go process can handle**. You might have to partition streams over multiple destinations to achieve a very high number of streams (in my case it has to be on the scale of tens of thousands streams).

## Performance of initial copy

Oversimplifying things, VReplication’s life cycle consists of two parts: **initial copy** (`SELECT + INSERT`) and the ongoing **stream of data from a binlog**.

It’s important that the initial copy of existing rows (as opposed to streaming from binlog) takes sensible time. To benchmark that, I have populated a table with 5M rows, each row of approximately 13Kb in size - making it 65Gb in total.

I observed the table taking **90 minutes to copy those 65 Gb**:

```
[14:18:31 vcopier.go:201] Copying table orders, lastpk: <nil>
[15:49:11 vcopier.go:328] Copy of orders finished at lastpk: map[lastpk:type:VARBINARY value:"fields:{name:\"tenant_id\" type:INT64} fields:{name:\"id\" type:INT64} rows:{lengths:3 lengths:7 values:\"1004893000\"}"]
```

*Tip: vttablet logs contain timestamps when a table started/finished to copy:*

```bash
$ kubectl logs production-vttablet-zone1-0428408676-c778c4e9 -f -c vttablet
```

Note that VTTablet comes with the `vstream_packet_size` setting that is advised to be adjusted to increase the throughput of the copy. The smaller it is, the more back-and-forth gRPC traffic we will see between vstreamer and vcopier: those will be more batches (smaller batches) of data sent from source to destination. I performed my test with `vstream_packet_size = 500’000` which is double the default value. That significantly increased copy speed on smaller sets than 5M.

**90 minutes to copy 65 Gb is ~722 Mb/min, or 12 Mb/sec**, which is not even close to network or disk bandwidth limits. The bottleneck is likely still in between Vitess abstractions or in GRPC.

It has to be noted that Vitess copies tables that are part of the same stream **serially**, which means that two 65 Gb tables would take 180 minutes to copy, not 90 minutes. This seems really wasteful given that we’d want to copy a lot of tables and it could be done in **parallel**. We’d likely have to change that part of VReplication’s behavior.

## Performance of binlog streaming

After VReplication is done copying existing rows, it will begin to stream the binlog to capture live changes. You can specify if you want VReplication to stream from a master or from a replica. Replicating from the master gives an advantage of no replication lag and that’s what I tried at first. I observed that (as expected) the data it copied was not lagged while the replica was lagged by hours. But above 50~ replication streams it seems like it’s too much load on the master, and changing VReplication to stream from a replica showed better scalability - largely because you can throw more replicas at it. However, the data in destination was as much lagged as the replica itself.

Eventually I was able to push that to as many as **400 streams** without breaking, processing **a binlog that had throughput of 330 mb/s**. The data copied with VReplication wasn’t delayed more than the replica itself which is a sign that the Go stack was keeping up with those 330 mb/s of binlogs.

## Tools

Controlling many VReplication streams as part of my experiments was tricky because the CLI tool to manage it mostly designed for machines, not for humans. Vitess docs even recommend a tiny [Go program](https://github.com/vitessio/contrib/blob/master/vreplgen/vreplgen.go){:target="\_blank"} that would generate shell commands to start VReplication.

To manage my experiments, I wrote a scrappy [ruby script](https://gist.github.com/kirs/d169c1534320c9e5f16b14007effcf22){:target="\_blank"} that allowed me to list, create, and delete streams without having to craft and escape SQL statements. Feel free to use it for your projects!

## Further reading

* [Analyzing VReplication behavior](https://github.com/vitessio/vitess/issues/8056){:target="\_blank"}
