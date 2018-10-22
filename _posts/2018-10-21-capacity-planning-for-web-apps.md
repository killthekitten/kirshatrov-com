---
layout: post
title: Capacity planning for web applications
date: 2018-10-21
comments: true
published: true
---

Lately, I've been looking into capacity planning at work which is the area that I've never known about much. In the last couple of months, I went from "I have no idea" stage into "ok, I think I know how it works". There's still a lot for me to learn but I wanted to write this post for a three month ago version of myself with a recap of all my findings. Hope it will be useful for others.

There's a lot of talk about the growth in tech, though I haven't seen many discussions around planning that growth from the engineering point of view. How do you know if the number of application servers that you run is enough? Or if it's way too high and you're wasting money? Or what if you have an upcoming launch even and you want to handle the expected traffic?

When doing capacity calculations, we'll assume that your workload is entirely stateless and scales horizontally without an external resource like a database becoming the bottleneck.

Let's refresh the terminology first:

**RPS / RPM:** requests-per-second and requests-per-minute. It's typical to operate in RPM on smaller loads, though most of the industry usually refers to RPS. "We get 100 RPS in peak" means that an app is serving 100 requests per second during the peak load, likely with a _pool_ of application servers rather than a single server.

**Steady and peak load.** In our previous example, we've used "100 RPS in peak". That would be the amount of traffic during the busiest hours, for instance on Black Friday if it's in the e-commerce domain. Outside of those hours, it's typical that the app would be serving much lower traffic, maybe 50 or 70 RPM.

**Application server.** Not to confuse with a load balancer (Nginx), an application server is something that runs your Ruby, Node, or Python app, listens to the TCP socket, accepts HTTP request, and returns the response from the app. Unicorn in Ruby or gunicorn in Python are good examples of application servers that use forking model. Puma is another common application server for Ruby, though it's using threads instead of forking which is a bit harder to model since it's concurrent.

**Worker**. A child process of the forking application server. A worker can serve only one request at the time. The app server would typically run 8 or 16 workers, depending on how fat you want the process to be.

**Under-provisioned:** lack of capacity which leads to higher response time or more frequent `502 Bad Gateway` responses.

**Over-provisioned:** running more capacity than you actually need and probably wasting money.

## Calculating from the scratch

Let's say that you get a business requirement to handle the load of 5000 RPS in peak. How do you find the optimal number of application servers required to serve this load?

The first thing to find is the distribution of response time. That metric is the key to calculating capacity. Let's imagine that the average response time of our app is **100ms**, which is enough to make a few queries to the database and render the HTML or JSON response.

Using that fact, we can find that a single instance of the application server can handle **10 RPS** (1s / 100ms). Which means that to serve 5000 RPS, we'll need 5000 / 10 = 500 application servers. For a forking server running 16 workers that would be 500 / 16 = 31.25 = **32 instances** of Unicorn or whatever another forking server.

## Translating workload into money

How do we translate that calculation into money? We'll use prices from Google Cloud Platform (GCP), which I personally prefer more than AWS since it's way less complicated than Amazon's offerings both in product view and in the pricing.

Depending on how CPU-intensive your workload is, a single web worker could take from 0.5 to 1 CPU. Regarding memory, it's not unusual for a Rails app to consume at least 1Gb, or even 2Gb for a larger app.

Let's imagine that the app is not heavy on CPU and mostly does I/O work (which is typical for web apps), and takes **0.5 CPUs and 1.5Gb RAM**. For 32 workers, that means **16 CPUs and 48 Gb RAM in total.**

A single `n1-standard-16` node in GCP with 16 CPUs and 60GB of memory would be enough to fit all that workload, though putting all of them on the same node wouldn't be wise for resiliency reasons.

Let's pick `n1-standard-4` node which has 4 CPUs and 15Gb on memory and [costs](https://cloud.google.com/compute/pricing#predefined){:target="_blank"} $97.09 / month. This node size would fit 8 workers of our app. We need 32 workers in total so 4 nodes would be $97.09 x 4 = **$388.36 / month**.

Now, let's take a look at Committed Use Discount that GCP provides. If you sign up for those nodes for a least a year, the monthly price for a node goes to down $87.38. Sign up for 3 years, and get it as low as $62.42 / month, or **$249.68** for 4 nodes vs $388.36 without any discounts.

There are even more opportunities to save! You could leverage [Preemptible VM instances](https://cloud.google.com/compute/docs/instances/preemptible){:target="_blank"} (nodes provided with no guarantee, they can go away at any point), in that case, `n1-standard-4` would cost as little as $29.20 / month - or **$116.8 / month** for all 4 nodes. But given that preemptible instances can go away at any point it makes sense to spread the workload between more nodes, and maybe switch to 8 x `n1-standard-2` for the same price.

As you can see, GCP is flexible in composing the workload and choosing the right commitment / discount for your business case. And if you're ready to take the risk of losing the capacity at any point in time, there's an opportunity to save ~70% of the costs by using preemptible instances.

# Finding the ceiling

What if you already have a production setup serving some number of RPS and you want to know its utilization and the ceiling of what it can handle?

Let's take Unicorn server for Ruby as an example. As a forking server, it spawns a number of child workers that serve actual requests.

By looking at how many of those workers are utilized, you could get an idea where you're at your current capacity. [Raindrops](https://bogomips.org/raindrops/){:target="_blank"} is the go-to library to monitor active workers count. If you know that only 4 out of 16 workers are busy on the average, it means that:

- It's currently 4 times over-provisioned
- It can handle 4 times more traffic, assuming that external dependencies (databases, APIs) can handle that load and the response time remains the same.

Note that even distribution of requests between workers is important. If your load balancer does a poor job in spreading the work between application servers, it's possible that one of them would get too much load while others would stay idle. [EWMA](https://github.com/kubernetes/ingress-nginx/blob/master/rootfs/etc/nginx/lua/balancer/ewma.lua){:target="_blank"} is currently one of the most efficient load balancing algorithms which is used by Google, Twitter, and Shopify.

## Why CPU utilization often does not matter?

It's common to implement some sort of autoscaling by looking at the node's CPU utilization. Low utilization would mean that instances are idle, and high (or closer to the limit) CPU usage would indicate that there's a need to scale up.

However, in modern web applications, CPU utilization does not correlate much with the capacity. Unless you're calculating Pi or Fibonacci, most of the time in your application will be spent while waiting for data from an external resource. That resource would be PostgreSQL, Redis, MongoDB, or any other database that you're using. If your app is talking to external APIs a lot, then it would be waiting for a response from an RPC endpoint or GraphQL/REST API.

## Wrap up

Something that I realized when getting my head around it is that all these calculations would never be too precise. All you can do is reduce the error by getting better at knowing your numbers.

In the end, we can promise to serve 5000 RPM with 32 Unicorn processes of 16 workers only when the response time stays around 100ms. If one of the queries hits the database too hard and it starts to return results slower, the response time will increase also, drastically reducing the capacity. It's important to invest into other areas that make your platform resilient: hard timeouts, [circuit breakers, bulkheading](https://github.com/Shopify/semian){:target="_blank"}, and [load shedding](https://en.wikipedia.org/wiki/Load_Shedding){:target="_blank"}.

[Hit me up](mailto:kirill.shatrov@shopify.com) if working on this sounds exciting, my team at Shopify is hiring! Our Scalability & Reliability team is all remote and distribured across Canada and Europe.

This post is only supposed to be a summary of my findings related to web capacity on non-threaded application servers. By no means, it's a complete guide to calculation your capacity. For instance, it doesn't touch the aspects of threaded web servers (e.g. [Puma](https://github.com/puma/puma){:target="_blank"}) or modeling the capacity of background jobs (e.g., Sidekiq or Resque).
