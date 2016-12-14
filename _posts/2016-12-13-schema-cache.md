---
layout: post
title: "Rails feature that you've never heard about: schema cache"
date: 2016-12-13
comments: true
published: true
---

I've been doing Rails development already for more than five years and only now I learned about the schema cache, although this feature is mostly relevant for apps under the massive scale.

# What is it for?

On boot, the Rails process makes `SHOW FULL FIELDS` query to get information about the [database structure and columns types](https://github.com/rails/rails/blob/5-0-stable/activerecord/lib/active_record/connection_adapters/abstract_mysql_adapter.rb#L883). This is required in order to know that the `created_at` column is `DATETIME` and we have to cast all values as a date time objects.

Now imagine that you have a hundred of Unicorn processes and you restart them in your production cluster. Every process will query MySQL with the same query: `SHOW FULL FIELDS`. Keep in mind that this query is quite expensive because it's not optimized as may be `SELECT` with an index.

A hundred application servers all making an expensive query at the same time may also kill your database! To avoid it, Rails provides with the schema cache feature. The idea is:

1. Serialize data about the schema (tables, columns, and types) into a file
2. Distribute that file over all application servers
3. Load the data from file to avoid hitting the database

Here is the chart with a number of queries not using index: you can totally see the moment when we enabled the schema cache!

<img src="{{ site.url }}/assets/post-images/schema-cache.jpg" />

## Implementation

In Rails <= 5.0, schema cache is serialized and persisted in [Marshal](https://ruby-doc.org/core-2.3.1/Marshal.html). In Rails 5.1, I [changed](https://github.com/rails/rails/pull/27042) schema cache to use YAML to preserve compatibility of serialized cache between different Rails version.

Anyway, the `SchemaCache` class is only 100 LOC and I suggest that you [check it out](https://github.com/rails/rails/blob/5-0-stable/activerecord/lib/active_record/connection_adapters/schema_cache.rb).

## Why you may need it?

Using schema cache may not be worth it with only a couple of application servers, but you may start using it as you scale your app and the number of Unicorns grows.

## Further reading

* [rails/rails#5162](https://github.com/rails/rails/pull/5162)
* [rails/rails#17632](https://github.com/rails/rails/pull/17632)
* [rails/rails#27042](https://github.com/rails/rails/pull/27042)

I have a plan to write more about Rails features that are not well known. Please let me know if you are interested in this topic.
