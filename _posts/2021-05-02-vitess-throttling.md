---
layout: post
title: "Throttling database load with Vitess"
date: 2021-05-02
comments: true
published: true
---

In his Percona Live 2020 [talk](https://www.youtube.com/watch?v=iQYZ0dRe7O8){:target="\_blank"}, [Shlomi Noach](https://github.com/shlomi-noach){:target="\_blank"} pointed out that he sees Vitess is an _infrastructure framework_ that would let everyone get database capabilities that you'd otherwise have to build yourself.

At Shopify, we've built our own system that lets us keep track of database health and replication lag, to throttle clients (mostly, background jobs) accordingly. It took us quite a bit of efforts to build that and to make it work at scale to handle 1000s of MySQL hosts.

I'm really excited about technologies like Vitess (and its direction as an infrastructure framework) that could bring capabilities like throttling database operations to everyone, not just to large companies like Shopify and Github that had resources [to invest](https://github.blog/2017-10-13-mitigating-replication-lag-and-reducing-read-load-with-freno/){:target="\_blank"} into a custom solution.

Not that long ago Vitess has got the [throttling capability available](https://vitess.io/docs/reference/features/tablet-throttler/){:target="\_blank"} and as soon I found about that this weekend, I was eager to try it and to sum my impressions.

## Setting up the cluster

We'll follow [Get Started guide for the Vitess Operator](https://vitess.io/docs/get-started/operator/){:target="\_blank"} to set up a dummy Vitess cluster.

Side note: I found Vitess Operator to be very easy to use; it cover all my basic needs and [its documentation](https://docs.planetscale.com/vitess-operator/api){:target="\_blank"} is good enough to not have to go to sources.

I'm going to use a GKE cluster because that's what I'm familliar the most, but you could as well use Minikube or another Kubernetes offering.

```bash
# create a tiny cluster
$ gcloud container clusters create sample-vitess-cluster --cluster-version 1.17 --zone us-east1-b --num-nodes 5

$ git clone git@github.com:vitessio/vitess.git
$ cd vitess/examples/operator

# before running kubectl, make sure to select the context with newly created cluster

# install vitess operator
$ kubectl apply -f operator.yaml

# provision VitessCluster
$ kubectl apply -f 101_initial_cluster.yaml

# port-forward to the cluster
$ ./pf.sh

# install vtctlclient if you haven't yet
$ go get vitess.io/vitess/go/cmd/vtctlclient

# setup the schema
$ vtctlclient ApplySchema -sql="$(cat create_commerce_schema.sql)" commerce
$ vtctlclient ApplyVSchema -vschema="$(cat vschema_commerce_initial.json)" commerce
```

Now you have the cluster running! With `pf.sh` running you have ports forwarded which should allow you to connect to it with `mysql -h 127.0.0.1 -P 15306 -u user` and explore things a bit.

## Enabling throttler

Following the [throttler docs](https://vitess.io/docs/reference/features/tablet-throttler/){:target="\_blank"} we can find that the throttler is currently disabled by default. We have to pass `-enable-lag-throttler` to vttablet to enable it.

The Vitess Operator makes that very easy:

```diff
diff --git a/examples/operator/101_initial_cluster.yaml b/examples/operator/101_initial_cluster.yaml
index 8df5c19c8..f2e5de108 100644
--- a/examples/operator/101_initial_cluster.yaml
+++ b/examples/operator/101_initial_cluster.yaml
@@ -62,6 +62,7 @@ spec:
             vttablet:
               extraFlags:
                 db_charset: utf8mb4
+                "enable-lag-throttler": "true"
               resources:
                 requests:
```

You can apply modified YAML with the same `kubectl apply -f 101_initial_cluster.yaml` that we've used above.

We will also need to somehow let the app talk to the throttler endpoint on vttablet over HTTP.

By default the Vitess operator does not expose it, so we'll create a `Service` ourselves:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: example-vttablet-commerce
spec:
  selector:
    "planetscale.com/component": vttablet
    "planetscale.com/keyspace": commerce
    "planetscale.com/cluster": example
  ports:
    - name: web
      port: 15000
      protocol: TCP
      targetPort: web
    - name: grpc
      port: 15999
      protocol: TCP
      targetPort: grpc
    - name: metrics
      port: 9104
      protocol: TCP
      targetPort: metrics
```

Note that our service points specifically to the _vttablet_ of the _commerce_ keyspace. That will allow our app to talk to the throttler endpoint on `http://example-vttablet-commerce.default.svc.cluster.local:15000/throttler/check`.

If you'd like, you could run `kubectl port-forward service/example-vttablet-commerce 15000` and browse [http://localhost:15000/](http://localhost:15000/){:target="\_blank"} to see vttablet's internal dashboard.

And if you visit [http://localhost:15000/throttler/check](http://localhost:15000/throttler/check){:target="\_blank"} via _curl_ or a browser, you could preview the throttler endpoint that we're going to hit from the script. Here's how it looks like:

```
{
  "StatusCode": 200,
  "Value": 0.243247,
  "Threshold": 1,
  "Message": ""
}
```

When `Value` is greater than the `Threshold`, you'll see `StatusCode` not equal 200. That means that the client should throttle.

### Throttled client

We have everything ready &ndash; let's create a sample script that heavily writes to the database and checks for throttling. I'm going to use Ruby as my language of choice.

To stress the database even more we'll employ multiple threads in the script.

```ruby
require 'bundler/inline'
gemfile do
  source 'https://rubygems.org'
  gem 'mysql2'
end

require 'mysql2'
require 'net/http'
require 'json'

THROTTLER_URI = URI('http://example-vttablet-commerce.default.svc.cluster.local:15000/throttler/check').freeze

puts "connecting..."

def db_healthy?
  resp = Net::HTTP.get(THROTTLER_URI)
  status = JSON.parse(resp)
  # Unhealthy would return 429
  status.fetch("StatusCode") == 200
end

threads = 20.times.map do
  Thread.new do
    client = Mysql2::Client.new(
      host: "example-vtgate-ae7df4b6.default.svc.cluster.local",
      username: "user",
      port: 3306
    )
    loop do
      unless db_healthy?
        puts "throttling!"
        sleep 1
      end

      values = 1000.times.map do |t|
        "(#{rand(1..5)}, 'SKU-1001', #{rand(100..200)})"
      end
      client.query("insert into corder(customer_id, sku, price) values #{values.join(', ')}")
    end
  end
end

threads.each(&:join)
```

The script creates a MySQL client per thread (that's important because the connection cannot be shared by threads) and each thread does a batch insert of 1000 rows at once.

## Running the experiment

You should find a way to run the script in the same Kubernetes cluster, either by putting it into an existing app or by building a new Docker image.

As soon as the script is running, you can follow vttablet's stats on [http://localhost:15000/](http://localhost:15000/){:target="\_blank"}. There you'll see the **sawtooth-like QPS chart**.

<img width="715" height="404" src="/assets/post-images/vitess-throttle.png" style="display: block;margin-left: auto;margin-right: auto;" />

The sawtooth shows that clients perform writes and then backoff, and then write again as database health recovers. It works!

## Wrap up

When doing the online schema migration, writing a backfill, or importing data into the database, it's important that clients check the database health before writing. This little demo shows how that can be accomplished with what Vitess gives you. Make sure to read the [full guide](https://vitess.io/docs/reference/features/tablet-throttler/){:target="\_blank"} that describes all features all the throttler.

Here are some things that I'd keep in mind if I was to roll this into production:

* vttablet runs next to the MySQL process. If the HTTP call to throttler would get on a hot or critical path, you would really not want all network bandwith of MySQL host to be eaten by calls to the throttler from a variety of clients. It's important that clients use some sort of **caching** when querying the throttler. For instance, freno [does](https://github.com/github/freno-client){:target="\_blank"} suggests to use a read-trough cache.
* Your application has to decide what _vttablet_ it needs to hit to check if it needs to throttle. That somewhat defeats the purpose of Vitess in the way of keeping clients dumb and unaware of the DB topology. I'd like to eventually put the throttle check into `vtgate`, the SQL proxy in front of Vitess.

Overall, I'm super excited to see Vitess making things like throttling super easy from the infrastructure point of view.
