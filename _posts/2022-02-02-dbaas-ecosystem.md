---
layout: post
title: "DBaaS ecosystem and economics"
date: 2022-02-02
comments: true
published: true
---


For the past six years I've been working on scaling Shopify, and a large part of that has been related to scaling databases. I've been  watching the databases space, and specifically _Database-as-a-Service_ (DBaaS) offerings, as we were building one for internal use at Shopify.

This post is a brief analysis of where the DBaaS ecosystem is moving, what have been some of the recent shifts, and why it's a profitable business.

## The beginning

The mass market of database as a service offering started with Heroku in 2007. They were the first to launch a PostgreSQL offering that could be configured for your app with a single click. It went off really well with the popularity of Rails and Heroku as the easiest hosting solution.

Amazon's RDS followed in 2009, first supporting only MySQL, and adding support for PostgreSQL in 2013.

Around the same time, Heroku noticed demand for managed Postgres for apps that run outside Heroku, and released the standalone offering.

Whether or not you used Heroku's Postgres or RDS, having a URL like `postgres://user3123:passkja83kd8@ec2-117-21-174-214.compute-1.amazonaws.com:6212/db982398` felt incredible. It required no DBAs, it was highly available and automatically backed up, and the best minds at Heroku and AWS worked on providing the highest uptime for your databases.

## DBaaS and margins

Let's try to compare Heroku's pricing to bare EC2 instances.

 Instance | <nobr>Monthly price <sup>1</sup></nobr> | Price difference
-- | -- | --
Heroku Premium 0<br/>4 Gb RAM / 64 Gb storage | $200 |  
EC2 t4g.medium <br/> 2 vCPUs / 4 Gb RAM / 64 Gb of io1 SSD | $69 | 2.9x
Heroku Premium 4<br/>32Gb RAM / 756 Gb Storage | $1,200 |  
EC2 r5.xlarge <sup>2</sup><br/>4 vCPUs / 32 Gb RAM / 756 Gb of io1 SSD | $630 | 1.9x
Heroku Premium 6<br/>122 Gb RAM / 1.5 Tb of storage | $3,500 |  
EC2 r5.4xlarge <sup>2</sup><br/>16 vCPU / 128 Gb RAM / 1.5 TB of io1 SSD | $1,965 | 1.8x

<div class="footnotes">
<p><sup>1</sup> Cost of a single EC2 instance with a disk is multiplied by 3 to account for High Availability which Heroku provides</p>

<p><sup>2</sup> I chose the r5 instance type as it's memory-optimized and recommended for high-performance databases</p>
</div>

To my calculations above, Heroku's margin is about 2x &mdash; in other words, for a Postgres instance that costs you $1,200, Heroku's infrastructure costs on AWS would be as low as $600. And doesn't take into account any vendor discounts that AWS usually gives.

RDS' pricing is close to Heroku in the order of magnitude, which means that AWS has a similar (if not larger) margin because they own the hardware and the internal price of EC2 must be even lower. And if as a cloud provider you can estimate that a typical lifetime of a database is at least couple years, and get an instance reservation and pay upfront, then you can another 60% discount on AWS.

Like many cloud offerings built on top of Compute, DBaaS is a highly marginal business that players are interested in getting into.

## Demand for scalable databases

All these companies that launched on of Heroku's and AWS' database offerings have been growing, and many of them (surprisingly) no longer fit into a single database. For some of them the constraint is the **data volume**, and for others it's the **write throughput**. There's always a limit for what a single compute instance can do, even if it's a well tuned database configuration running in 96 CPUs.

It's common to [implement application-level sharding](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale){:target="\_blank"}, but that incurs higher complexity and (often) an open-heart surgery of production data. Sometimes, it's much cheaper to do sharding on a layer below the application.

This spawned the next generation of database offerings, such as [PlanetScale](https://planetscale.com/){:target="\_blank"} (aka hosted Vitess), [Aurora](https://aws.amazon.com/rds/aurora/){:target="\_blank"}, and [Hyperscale](https://docs.microsoft.com/en-us/azure/postgresql/hyperscale/overview){:target="\_blank"} (aka [Citus](https://www.citusdata.com/){:target="\_blank"} managed by Microsoft). All of them give something that looks like the same relational MySQL or Postgres, but provides 'automatic' horizontal scaling behind.

Same happened for non-relational databases like Redis. [Redis Labs](https://redis.com/){:target="\_blank"} started from offering single Redis instances and moved to Redis Cluster that scales behind the scenes.

## Wrap up

This is a great time to run and sell value added infrastructure on compute, and the larger you get, the cheaper that infrastructure is for you to run due discounts and reservations.

Large companies would run things internally, but there's a great market for small and medium size companies who're willing to pay for their databases to be hosted by someone, as hiring DBAs is even harder than hiring SREs.

We're starting to see the rise of managed, horizontally scaled databases as a service. Single instance databases would merely come as building block of orchestrated systems like [Vitess](https://vitess.io/){:target="\_blank"}.


