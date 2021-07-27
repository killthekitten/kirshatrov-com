---
layout: post
title: "Quick way to run a Ruby script in Kubernetes"
date: 2021-07-21
comments: true
published: true
---

Sometimes I find myself in need of running a Ruby script on a live Kubernetes cluster. In today's example, it had to do with generating load on MySQL, which was tricker to do from my laptop. The script had to run close to the workload in the cluster.

I'm lazy and having to build and push a Docker container with my script would be a lot of extra work.

Luckily, thanks to K8S config maps and to Bundler [inline mode](https://bundler.io/guides/bundler_in_a_single_file_ruby_script.html){:target="\_blank"}, this can be achieved without having to build a custom container.

First, let's create a config map with our code:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: load-generator
data:
  writer.rb: |
    require 'bundler/inline'
    gemfile do
      source 'https://rubygems.org'
      gem 'mysql2'
    end

    require 'mysql2'
    client = Mysql2::Client.new(database: 'commerce')
    loop { client.query("select * from orders") }
    # more code follows...
```

And then the deployment that pulls `ruby:2.7` image and runs the file from our config map.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: load-generator
  name: load-generator
spec:
  replicas: 1
  selector:
    matchLabels:
      app: load-generator
  template:
    metadata:
      labels:
        app: load-generator
    spec:
      containers:
      - image: ruby:2.7
        name: ruby
        command: ["ruby"]
        args: ["/app/writer.rb"]
        volumeMounts:
          - name: load-generator
            mountPath: /app/writer.rb
            subPath: writer.rb
      restartPolicy: Always
      volumes:
        - name: load-generator
          configMap:
            name: load-generator
```

All you need is `kubectl apply -f` YAMLs above and you'll have your script running.
