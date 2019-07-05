---
layout: post
title: Boosting application boot time with container snapshots
date: 2019-07-06
comments: true
published: false
---

Recently I came across the [CRIU technology](https://criu.org/){:target="_blank"}. It lets you checkpoint any running application and serialize its state on disk, to resume it later from that state. What's more interesting is that it comes with the [Docker integration](https://criu.org/Docker){:target="_blank"}, potentially allowing you to run a container, make a serializable snapshot of it and recreate it later - possibly even on another host.

This technology might be beneficial for live migrations (in fact, [Google uses it](https://www.linuxplumbersconf.org/event/2/contributions/69/attachments/205/374/Task_Migration_at_Scale_Using_CRIU_-_LPC_2018.pdf){:target="_blank"} to live migrate batch jobs in Borg) - but what excited me is that this could help with the **long boot time problem**. As a Rails app grows, it ends up with more Ruby code to parse and load on boot, which makes the startup time quite long. Autoloading and [bootsnap](https://github.com/Shopify/bootsnap/){:target="_blank"} help in local and CI environments, but in production (where you want to eager-load everything) is still quite slow. It's not uncommon for some of the largest monoliths to take 1+ minute to startup before it's able to serve requests.

Note that I'm using Rails as an example, but technically this applies to any app written in a scripting language with ever-growing database and number of dependencies.

If we could prepare a snapshot of a live application server beforehand and use that to start containers in production, maybe we could **save some of the boot time**? That's is what I wanted to explore.

The brief content of this post is: 1) setting up a lab with Docker + CRIU to snapshot and restore containers 2) automating that with a script and leveraging compute instances in Google Cloud 3) measuring the savings.

## Setting up a lab

All CRIU magic is based on Linux kernel features, so Docker for Mac is not an option. I would have to setup a Linux VM with all the dependencies.

One option would be to spin an instance on AWS or GCP, but I've already had VMWave on my Mac, and I wanted to save some terminal latency (my ISP in France was not great!). I went with a Linux Alpine VM in VMWare since I've heard that Alpine is a good lightweight distributive. It wasn't too hard to install CRIU and Docker on it with `apk`. However, as I tried to verify the setup with `criu check` I found that for some reason the Linux kernel that comes with Alpine doesn't have all the features needed for CRIU.

I wasn't looking forward building my own kernel, so I went ahead with Ubuntu Server 18.04 LTS which would hopefully come with a full-feature kernel.

I followed [the CRIU docs for Docker](https://www.criu.org/Docker){:target="_blank"}. I've noticed that they were disabling [seccomp](https://docs.docker.com/engine/security/seccomp/){:target="_blank"} (with a note that a newer kernel is required) and the container network was disabled as CRIU won't checkpoint any open TCP connections. I decided to try it anyway and see if it becomes an issue later.

It worked amazingly for an elementary Rails app (I was able to snapshot live and restore!), but as soon as I made the app talk to a database, I've noticed that `docker checkpoint` was failing with a CRIU-level error:

```bash
$ cat /run/containerd/io.containerd.runtime.v1.linux/moby/be56af6556e28725f3d69b4d91c8905268521af9d32e8aa4525fe16a07138a5e/criu-dump.log

...
(00.152987) sockets: Searching for socket 0x27a13 family 2
(00.152991) Error (criu/sk-inet.c:199): inet: Connected TCP socket, consider using --tcp-established option.
```

I started looking for a way to enable `tcp-establish`. The CRIU configuration guide [suggested](https://criu.org/Configuration_files){:target="_blank"} `echo 'tcp-established' > /etc/criu/runc.conf` for containerized deployments. However, doing it had no effect. That's when I found that the support for configs only arrived in runc 1.0-rc7 and CRIU 3.11 - while Ubuntu packages came with older runc 1.0-rc4 and CRIU 3.6.

It took me some time to build the latest runc and CRIU from sources, but finally, I was able to snapshot a process with open TCP sockets and seccomp enabled! That was a success. I could even jump into the snapshot and see its content:

```
./checkpoint-omg/
./checkpoint-omg/mountpoints-12.img
./checkpoint-omg/inventory.img
./checkpoint-omg/tmpfs-dev-73.tar.gz.img
./checkpoint-omg/tmpfs-dev-72.tar.gz.img
./checkpoint-omg/core-9.img
./checkpoint-omg/tmpfs-dev-71.tar.gz.img
./checkpoint-omg/core-1.img
./checkpoint-omg/core-10.img
./checkpoint-omg/cgroup.img
./checkpoint-omg/core-15.img
./checkpoint-omg/fdinfo-2.img
./checkpoint-omg/core-11.img
./checkpoint-omg/core-14.img
./checkpoint-omg/ids-1.img
./checkpoint-omg/core-20.img
./checkpoint-omg/pipes-data.img
./checkpoint-omg/core-17.img
./checkpoint-omg/fs-1.img
./checkpoint-omg/mm-1.img
./checkpoint-omg/tmpfs-dev-68.tar.gz.img
./checkpoint-omg/utsns-11.img
./checkpoint-omg/pagemap-1.img
./checkpoint-omg/core-12.img
./checkpoint-omg/seccomp.img
./checkpoint-omg/core-13.img
./checkpoint-omg/tmpfs-dev-74.tar.gz.img
./checkpoint-omg/pstree.img
./checkpoint-omg/core-8.img
./checkpoint-omg/core-19.img
./checkpoint-omg/core-16.img
./checkpoint-omg/ipcns-var-10.img
./checkpoint-omg/tcp-stream-cd45.img
./checkpoint-omg/files.img
./checkpoint-omg/pages-1.img
./checkpoint-omg/core-18.img
./checkpoint-omg/descriptors.json
./checkpoint-omg/core-7.img
./checkpoint-omg/tcp-stream-6b38.img
```

Each of those dumps is inspectable with `crit show`.

Now it was time to prepare some kind of a sample Rails app that's slow to boot.

From Shopify experience, it comes to huge amount of code to load and parse. That code includes classes in your app, a bunch of YAML configuration (for a large app, it's natural to have lots of configs around), and all your gem dependencies.

To simulate all of that, I stuffed the Gemfile with **250 gems** and wrote a small code generator for Ruby and YAML.

Now was time to checkpoint the fat app and try to restore it. That was easy enough!

```bash
$ docker run --name fat-app-donor -p 3000:3000 -d fat-app:latest
# curl localhost:3000 to verify that the app is booted and running

$ docker checkpoint create fat-app-donor my-checkpoint
# the checkpoint is located in /var/lib/docker/containers/<donor-container-id>/checkpoints/my-checkpoint

$ docker create --name fat-app-clone -p 3000:3000 fat-app:latest

$ cp -r /var/lib/docker/containers/<donor-container-id>/checkpoints/my-checkpoint /var/lib/docker/containers/<clone-container-id>/checkpoints

$ docker start --checkpoint my-checkpoint fat-app-clone
```

Yay! You can now `curl localhost:3000` and hit the container  that has been restored from a serialized state!

## Automating and running in environment closer to production

In the step above, I was able to take the snapshot of a live container on one local Ubuntu VM and re-create it on another, but I also wanted to run the experiment in a production-like environment. I planned to create a GCE instance, upload the container snapshot to GCS (S3-like store from Google), download it from GCS, and recover from it.

Why upload and download the container to/from the remote store? I wanted to make it as close as possible to production and measure the penalty of downloading that blob.

I was able to automate all these steps based on commands that I was running manually before. Rather than describing the steps, I thought it would be self-explanatory if you read the script itself.

{% raw %}
```bash
set -e -x

IMAGE=fat-app:latest
CHECKPOINT_NAME=checkpoint-omg

echo "+++ SNAPSHOT PART"

docker run --name fat-app-donor -p 3000:3000 -d $IMAGE

echo "+++ Waiting for container to boot"
time (while ! curl localhost:3000 > /dev/null 2>&1; do : sleep 0.5 ; done )

echo "+++ Boot stats"
curl http://localhost:3000/stats

echo "+++ Creating a checkpoint"
sudo time docker checkpoint create fat-app-donor $CHECKPOINT_NAME

DONOR_CONTAINER_ID=$(docker inspect --format="{{.Id}}" fat-app-donor)

echo "+++ Packing the checkpoint"
sudo time tar cvzf checkpoint.tar.gz -C /var/lib/docker/containers/$DONOR_CONTAINER_ID/checkpoints .

echo "+++ Checkpoint size:"
ls -l --block-size=M

echo "+++ Uploading the checkpoint:"
time gsutil cp checkpoint.tar.gz gs://kirs-criu/checkpoints-experiment/$CHECKPOINT_NAME.tar.gz

echo "--- RESTORING"

echo "+++ Downloading the checkpoint:"
time gsutil cp gs://kirs-criu/checkpoints-experiment/$CHECKPOINT_NAME.tar.gz .

echo "+++ Preparing the new container"
time docker create --name fat-app-clone -p 3000:3000 $IMAGE

CLONE_CONTAINER_ID=$(docker inspect --format="{{.Id}}" fat-app-clone)

echo "+++ Unpacking the checkpoint to clone docker dir:"
sudo tar -C /var/lib/docker/containers/$CLONE_CONTAINER_ID/checkpoints -xvf $CHECKPOINT_NAME.tar.gz
rm $CHECKPOINT_NAME.tar.gz

echo "+++ Launching the clone from the snapshot:"
time docker start --checkpoint $CHECKPOINT_NAME fat-app-clone

curl http://localhost:3000
curl http://localhost:3000/stats
```
{% endraw %}

I've run the script for 2 apps: fat-app (one that I've built) and [Redmine](https://www.redmine.org/){:target="_blank"}. I've chosen Redmine since it's a good example of a typical Rails app that has a bunch of gems and classes. It's also not as well optimized as Discourse, which is good in our case.

You're probably most curious about the results in time to boot versus time to restore from the snapshot.

## Results

I got the results for both apps running on 2 types on VMs: _n1-standard-1_ (single vCPU GCE instance) and _n1-standard-16_ (16 vCPUs).

The way I measured hot and cold start was by taking the delta in time from since starting the container to being able to serve an HTTP request.

  | Checkpoint size | Checkpoint download | Cold start | Hot start | Perf boost
-- | -- | -- | -- | -- | -- | -- | --
Fat-app; 1 vCPU | 44.3 Mb | 2.16s | 18.58s | 7.96s | +2.33x
Fat-app; 16 vCPU | 44.3 Mb | 1.94s | 20.60s | 6.34s | +3.25x
Redmine; 1 vCPU | 24.3 Mb | 2.02s | 18.39s | 6.33 | +2.91x
Redmine; 16 vCPU | 24.3 Mb | 1.95s | 13.48s | 3.71s | +3.63x

**Starting the app from a snapshot gives quite a significant boost:** at least 2.3x on a single core machine and at most 3.6x on a VM with more compute power. The difference between CPUs is likely due CPU-bound work to unpack/unserialize the dump. I've also tried it on VMs with SSD disks, but I didn't see as much improvement as after adding more CPUs.

Faster time to download the snapshot can be explained by GCP allocating higher network bandwidth to larger VMs.

This took me around a week of work to get working, and I'm pretty impressed by the results.

## Things to mind for production use

### Is CRIU even prodiction grade software?

Based on my research, it is. It's been used at [Google's Borg for years](https://www.linuxplumbersconf.org/event/2/contributions/69/){:target="_blank"} to live migrate workloads (through not with Docker), and the Docker support has been there since ~2015. Though it might still have edge cases which will need to be reported.

### Dynamic hostname

When CRIU snapshots the container namespace, it persists the container hostname too. On restore, it sets the hostname of the donor container to the cloned container. This is not unexpected but might create a problem in case you're running multiple instances of the same container on a single host - which is a typical setup for horizontally scalable web apps. And in orchestrated environments like K8s the hostname that's part of a replicated set is randomly generated (example: `web-7cfd6d677d`).

For our use case, it means that we'll need to change the hostname of the clone to avoid having the same hostname everywhere. Luckily, there's a way for that which CRIU maintainers shared with me in [https://github.com/checkpoint-restore/criu/issues/727](https://github.com/checkpoint-restore/criu/issues/727){:target="_blank"}.

From the application perspective, we must prepare to always dynamically check the hostname. It means that you can no longer memoize it:

```ruby
# typical code to avoid extra syscall on repeating hostname access
def hostname
  @hostname || Socket.gethostname
end
```

This might be harder to enforce, but at least one crazy solution would be to periodically check `ObjectSpace` for any strings that contain the memoized hostname. At the end, there's not too much business logic that depends on hostname. It's mostly the infrastructure code that you'd have to adjust.

### TCP connections

While [CRIU and Linux kernel has support for restoring TCP connections](https://criu.org/TCP_connection){:target="_blank"}, it's essential that the app is ready to reconnect to all kinds of resources once its snapshot has been restored on a new host. Fortunately, this is not a problem for any mature and large-scale app that's already designed for resiliency. Retries and reconnections is an essential part of that.

### Preparing the snapshot

Before a new release, you'd have to prepare the snapshot of the container to be used in production. This perfectly falls into the model of building release artifacts on the CI. In the end, CI is already most likely involved in building the image and pushing it to the container registry.

### Orchestrated environments

This is probably the most significant blocker on the way to adopt CRIU for containers in production. It's hard to imagine anyone managing containers manually nowadays with container orchestration frameworks like K8s becoming the standard.

If Kubernetes is managing your containers and invoking `docker start` on the actuals hosts, it would have to be aware of all concerns related to restoring from a snapshot vs booting a new instance from scratch.

I imagine this making Kubernetes pods aware of restoring won't be incredibly hard. Similar to Google's Borg, we could make it prefer to restore from the snapshot if it's available, and fall back to boot from scratch if starting from a snapshot didn't work for some reason.

Here's an example of how YAML spec may look like:

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: web
    image: gcr.io/companyname/project:sha
    snapshotPolicy: IfPresent # start container from the snapshot if it's available
    snapshotPath: gs://companyname-snapshots/project/sha/boot-snapshot.tar.gz
    ...
```

There is work in Kubernetes required to push for CRIU adoption, however, I see at least couple reasons that can make it easy to sell to the community. Kubernetes is an open source successor of Borg, and Borg supports CRIU. And Docker support for CRIU already exists so this is mostly a matter of integrating Docker feature with K8s.

## Resources

* [My setup and benchmarking script](https://gist.github.com/kirs/8e73fef83db2fd3dd8541df04b5ba3d4){:target="_blank"}
* [A talk about CRIU and Ruby from RubyKaigi](https://rubykaigi.org/2019/presentations/udzura.html){:target="_blank"}