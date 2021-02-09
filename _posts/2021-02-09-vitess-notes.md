---
layout: post
title: "Vitess: scrappy notes"
date: 2021-02-09
comments: true
published: true
---

I’ve been playing with [Vitess](https://vitess.io/){:target="\_blank"} at work, and I’ve been finding it extremely hard to Google for common issues and error messages from Vitess. While the official docs are improving, there’s a general lack of stack overflow -like tips for fixing silly errors. I decided to keep my own log in this post, partially for myself.

## Vitess on CI

Vitess ships with a test server that gives you a quick way to run it on CI or for local development. I found it extremely easy to run and it worked really well.

Here's a docker-compose snippet that my collegue Hormoz and I have worked out:

```yaml
# docker-compose format
services:
  vttest:
  image: vitess/vttestserver:mysql57
  command:
    - "/vt/bin/vttestserver"
    - "-alsologtostderr"
    - "-port=2222"
    - "-mysql_bind_host=0.0.0.0"
    - "-vschema_ddl_authorized_users=%"
    # comma-separated list of keyspaces
    - "-keyspaces=unsharded,sharded,archive"
    # number of shards per each keyspace
    - "-num_shards=1,2,1"
    # in case you want to mount vschema definitions:
    # - "-schema_dir=/db/vitess/schema"
```

## Populating schemas

To run tests on CI you'd want to populate Vitess instance with a schema. There's at least two ways to do that.

* The easiest way: populating through `vschema.json`
  * You can choose to pass `-schema_dir` and mount a directory that would have a matching hierarhy of keyspace name and `vschema.json`
* Populating manually with DDLs
  * You can also choose to have your own script execuring `alter vschema` and `create table` on the test server
  * This is a bit more complex but provides flexibility if you want the set of tables to be dynamic
* Through CLI with `vtctl ApplyVSchema`
  * This will require `vtctl` to be available which is generally not the case in your app's CI container

## VSchema DDLs

If you try to run `alter vschema` on the test server, you'll likely run into:

```
> alter vschema add table sharded.products;
ERROR 1045 (HY000): vtgate: http://a90e850de0ed:2222/: not authorized to perform vschema operations
```

You'll want to run the test server with this flag to allow any users to manipulate vschema:

```
-vschema_ddl_authorized_users=%
```

## Errors in vschema.json

If you decide to populate VSchema through mounting a `vschema.json` file, on a malformed JSON schema you'll see the process crash with an error like:

```
main.go:162] initTabletMapProto failed: cannot load vschema file /schema/sharded/vschema.json for keyspace sharded: json: cannot unmarshal object into Go value of type []json.RawMessage
```

While something there gives you a pointer that JSON cannot be matched into Go value, I found this error quite confusing and I had to navigate into Vitess sources to look up what schema/protobuf the JSON is expected to be. That let me find out that what had to be an array was a map in my case.

## Making application ready for sharding

If you're onboarding existing app to Vitess, you'll likely have some queries fail because they're not ready to be sharded or not compatible with Vitess.

```
Minitest::UnexpectedError: ActiveRecord::StatementInvalid: Mysql2::Error: vtgate: unsupported: You can't update primary vindex columns. Invalid update on vindex: hash
    app/models/product.rb:253:in `publish'
```

What makes it harder to debug is that you don't see the full SQL query that failed. As I was making it work in a Rails app, I've added the following CI-only patch to Rails to log all queries that failed on vtgate.

```ruby
module ActiveRecord
  module ConnectionAdapters
    class AbstractAdapter
      module VitessErrorLogger
        def log(sql, *args, &block)
          super(sql, *args, &block)
        rescue Mysql2::Error => error
          if error.message.include?("vtgate")
            puts "[VITESS] #{error}"
            puts "[VITESS] Full sql:\n#{sql}"
          end
          raise
        end
      end
      prepend AbstractAdapter::VitessErrorLogger
    end
  end
end
```

I might refresh this post with more things that I run into.
