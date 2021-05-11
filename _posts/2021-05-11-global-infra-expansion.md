---
layout: post
title: "Global infrastructure expansion"
date: 2021-05-11
comments: true
published: true
---

Having been working on the global expansion of Shopify's infrastructure footprint, I noticed there's at least two patterns of you can follow when deploying a web service globally for both latency and reliability improvements.

## Single source of truth + edge compute

You leverage the edge compute (either with your own proxy deployment or with CloudFlare) to cache responses of your app that's running in a single location.

The challenge comes with expiring those edge-cached responses: once the data has changes in the source of truth, it has to tell _every_ edge that cache has to be expired.

Having 200+ points of presence on the edge (the Cloudflare's [number](https://www.cloudflare.com/en-gb/network/){:target="\_blank"}) combined with frequent updates could make this multiplexing either wasteful (single update to source does a fan-out to _every_ edge), or you have to get really good at your cache keys. The [Cache-Tag way by CloudFlare](https://blog.cloudflare.com/introducing-a-powerful-way-to-purge-cache-on-cloudflare-purge-by-cache-tag){:target="\_blank"} might be a great solution for this.

For infrequently updated data, this solution could be simple and very cost effective, without having to replicate databases yourself like the other path below suggests.

# Regional compute + replication

In comparison with the previous way, we do not involve edge and instead deploy **regional compute**. The difference is that regional compute assumes only having some presence on each continent. Something like 5-8 regions makes it enough to cover the most of the world. This is different from the edge approach where you may end up having [hundreds](https://www.cloudflare.com/en-gb/network/){:target="\_blank"} of points of presence.

Then you could either shard your workloads by a region, but something that's not feasible. In that case you can choose to **replicate data from your single source of truth into the regional compute**. It depends on your data store of choice, but normally this would be just another replica in your PostgreSQL/MySQL/ElasticSearch topology.

This works quite well with dynamic but read-only workloads, say templated pages that might need to fetch arbitrary rows from the database - stuff that's way harder to do on the edge.

It's worth mentioning that running regional compute can get more expensive because of storage costs that now multiple by the number of regions you use - unless you can somehow replicate selectively.

# Conclusion

Every app and business is unique and the mental model I presented may not work for everyone. Please share your findings or alternative paths that you see.
