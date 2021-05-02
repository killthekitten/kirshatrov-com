
https://vitess.io/docs/reference/features/tablet-throttler/


We'll follow [Get Started guide for the Vitess Operator](https://vitess.io/docs/get-started/operator/) to set up the cluster running.

I'm going to use a GKE cluster because that's what I'm familliar the most, but you're welcome to do the same on Minikube or other Kubernetes offering.

# create a tiny cluster
gcloud container clusters create vitess --cluster-version 1.14 --zone us-east1-b --num-nodes 5

git clone git@github.com:vitessio/vitess.git
cd vitess/examples/operator

# install vitess operator
kubectl apply -f operator.yaml

# bring up the same cluster
kubectl apply -f 101_initial_cluster.yaml

# create a tunnel into the cluster
./pf.sh

# setup the schema
vtctlclient ApplySchema -sql="$(cat create_commerce_schema.sql)" commerce
vtctlclient ApplyVSchema -vschema="$(cat vschema_commerce_initial.json)" commerce


Following the [throttler](https://vitess.io/docs/reference/features/tablet-throttler/) we can find that the throttler is currently disabled by default. We have to pass `-enable-lag-throttler` to vttable to enable the throttler.

The Vitess operator makes that very easy:

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

We will also need to somehow let the app talk to vttablet over HTTP to the throttler endpoint.

By default the Vitess operator does not expose it, so we'll create a Kubenetes Service ourselves:

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

Note that this services points specifically to the _vttablet_ of the _commerce_ keyspace. That will allow our app to talk to `http://example-vttablet-commerce.default.svc.cluster.local:15000/throttler/check`, the throttler endpoint.

If you'd like, you could even run `kubectl port-forward service/example-vttablet-commerce 15000` and browse [http://localhost:15000/](http://localhost:15000/) to see vttablet's internal dashboard.

And if you visit http://localhost:15000/throttler/check via curl or your browser, you could preview the throttler endpoint that we're going to hit from the script.

```
{
  "StatusCode": 200,
  "Value": 0.243247,
  "Threshold": 1,
  "Message": ""
}
```

### Throttled client

We have everything ready - let's create a sample script that heavily writes to the database and checks for throttling. I'm going to use Ruby in my case.

To stress the database even more we'll use multiple threads in the script.

```ruby
require 'bundler/inline'
gemfile do
  source 'https://rubygems.org'
  gem 'mysql2'
end

require 'mysql2'
require 'net/http'
require 'json'

THROTTLER_URI = URI('http://example-vttablet-commerce.throttled-vitess.svc.cluster.local:15000/throttler/check').freeze

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
      host: "example-vtgate-ae7df4b6.throttled-vitess.svc.cluster.local",
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

The script creates a MySQL client per thread (that's important! because threads can't share the same connection) and each thread does a batch insert of 1000 rows at once.

Now if you follow vttablet's stats on http://localhost:15000/ you'll see the sawtooth-like QPS chart.

sawtooth