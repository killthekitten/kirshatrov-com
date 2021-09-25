---
layout: post
title: "Fragmented prototyping"
date: 2021-09-25
comments: true
published: true
---

You're about to start a new project at work that has a large amount of uncertainty: you know that you want to achieve X, but you don't necessarily know how, or maybe there's three different ways to implement it and you don't know what's the best in your context.

There comes throw-away prototyping (see Simon's [Drafts](https://sirupsen.com/drafts/){:target="\_blank"} as well). Prior to starting the project for real, you attempt to assemble a working prototype that you'd throw away later. The throw away part allows you to cut any corners you'd like, write quick and dirty code with no tests, all for the sake of learning how to build this right.

Last year, when building a dirty prototype of Shopify's Points of Presence (PoPs) project, we discovered an important detail of our integration point with CloudFlare that later significantly dictated the design when we were building it for real.

You can think of prototyping as a [progressive JPEG method](https://www.artlebedev.com/mandership/167/){:target="\_blank"}:

> There is a real simple time-management approach called Progressive JPEG. The method is characterized by every project being 100% complete at any given moment, although it might be only 4% detailed.

But sometimes scope gets so big that it comes much harder to have the big picture and to prototype it a sensible amount of time.

For those kinds of project, I suggest the model of **Fragmented prototyping**:

<img src="/assets/post-images/progressive-jpeg-kirs.jpg" class="px-5" />

Instead of aiming for a full picture, you focus on the most challenging and unknown parts of the project.  Sometimes it's the domain model. Sometimes it's answering whether an existing open source framework or technology is the right choice. Sometimes it's "would technology X fit 1000s of entities?". I've seen many commercially advertised products not keep up with, say, the number of Kubernetes clusters or number of load balancers that we'd want to fit in there.

This post was influenced by a recent example of project at work. It had to do a lot with infrastructure and databases, and streaming large quantities of data in a high level language like Go. The team and I focused on parts that were the most unknown and worked for two months playing with each of those components.

<img src="/assets/post-images/fragmented-prototyping.svg" width="500" style="margin: 0 auto;" />

In our exploration phase, we stayed away from the center piece. Instead, we focused on "fragments" that are in corners, and we finished the exploration being a lot more certain in those hard parts, having a good idea what technology and stack we could base this on. In other words, we worked out the riskiest things that could otherwise undermine the project later.
