---
layout: post
title: "Five years at Shopify"
date: 2021-01-20
comments: true
published: true
---

<img src="/assets/post-images/five-years-at-shop.png" width="250" alt="" class="bordered" style="margin: 0 auto"/>

This week I have celebrated a five year anniversary working at Shopify, one of the world’s biggest ecommerce platforms. It’s been an incredible journey and I’d like to use this anniversary as a chance to reflect about my time at Shopify.

## Where I was coming from

Prior to Shopify I was at [Evil Martians](https://evilmartians.com/){:target="\_blank"}, a product development consultancy. That’s probably the best smaller size company that I could have ever worked at. Martian’s culture has allowed me to work on open source, speak at conferences like RailsConf, and work with high profile clients from Y Combinator and the _Fortune 500_ list.

As much as I enjoyed staying there, at certain point I’ve been curious to explore the next challenge. As one of the oldest tech companies that was using Rails from the day one (and where the CEO used to be a Rails committer), Shopify seemed like a really exciting place to join.

## My path at Shopify

Back in **2016** I’ve started on the Developer Acceleration team at Shopify. My job there was to make developers more productive working on Shopify’s codebase. For a year, I’ve worked on our [chat ops solution](https://www.youtube.com/watch?v=bnwrkVXu-cw){:target="\_blank"}, on our CI pipeline that runs 150k unit tests for a monolith in just 20 minutes, and on upgrading the monolith to the latest Rails version at that time. I spent most of my time on Rails upgrade which turned out to be tricky as the number of breaking changes from Rails 4.2 to 5.0 was quite high. Nevertheless, that project has allowed me to contribute to a bunch of major libraries in the Rails ecosystem as we found bugs when running on Rails 5.

In **2017**, I switched teams to work on the production infrastructure rather than developer tooling. That was the year of moving from bare metal datacenters to the cloud ⛅️, and I worked on adopting our datacenter tooling to be Kubernetes and cloud friendly.

On of the key constraints brought by Cloud was ephemeral compute so I had to somehow make Rails processes like Resque/Sidekiq workers interruptible. That’s how [job-iteration](https://github.com/shopify/job-iteration) was born. I slowly dived into our background job infrastructure and spent the most of 2018 working on that as well.

By the late **2018** we’ve been running in Cloud but we weren’t fully leveraging it - for instance we’ve had a static number of application servers, much like we used to have back in the datacenter. I shifted my work towards capacity planning and autoscaling, and by **2019**, my team has shipped an autoscaler that matched capacity to business needs of the platform, saving the company a few $M every month.

Thanks to horizontal sharding, we could always scale the platform by adding more shards - but by **2020**, we’ve started to see more limits being hit _within_ a shard. I moved towards working with OLTP systems and MySQL, specifically researching data access patterns and caching.

Later in **2020**, we’ve assembled a team to deploy Shopify around the globe - and successfully shipped that and reduced latencies by 200ms for regions like Australia that are the furthest away from North America.

I learned a ton and I found areas that I enjoy the most, such as growing engineers and project management. I've got to specifically like focusing on delivery of larger projects, where I can focus on building a roadmap, aligning teams and communicating the plan to the rest of the company.

## My challenges

It wouldn’t be fair to highlight only the exciting parts. Through my five years here, I've got to work with managers with whom I wasn't very much agreable because of our differences. I struggled close to the point when I've considered quitting, and I'm glad that I didn't. One of the perks of working in a larger place is internal mobility, and an opportunity to make a career within the same company by changing organizations and managers. My advice here is not to let the uncomfortable situation run for too long. In my case that struggle with a manager was going for 1.5 years, all because we tried to "work out" the relationship for way too long. It only got clear that the change is required when it got to the peak of discomfort.

Shopify is also a different company now compared to the place that I've joined five years ago. It grew to be 10 times bigger, and you can imagine the culture adjusting to the size. The processes have been adjusting too, and what used to be scrappy and easy (or YOLO) back in the days is now documented and has rules.

## What's next

Working at a large company has its perks of allowing you to try yourself in different roles and projects, and building a career within that company. To me that’s been the biggest reason to stick around. And as you stay at once place for longer, you get more and more trust from people from all around the company, which unlocks even more opportunities to try.

Being based in the UK and having the majority of collegues in Canada made me travel to our offices quite often, and that's the biggest thing that I miss since the pandemic. I can't wait for a chance to reconnect and see all the faces again.

I look forward for the next half-decade here, for more partnerships with excellent peers at work, and for more challenging projects that are always a joy to write about in my blog.
