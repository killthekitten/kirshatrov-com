---
layout: post
title: "Materializing tables with Vitess"
date: 2021-05-10
comments: true
published: true
---

I wrote this post as I was playing with materializing tables in Vitess. I find that there's not that many resources online that walk through Vitess features. I hope this post is useful for whoever is looking at Vitess capabilities.

***

Let's imagine an example of the following schema in an abstract ecommerce app:

```sql
CREATE TABLE `products` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `product_type` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

In the rendering layer of the ecommerce app, you may find the following query appear as a hot one:

```sql
SELECT DISTINCT product_type
FROM products
WHERE tenant_id = %tenant_id%
```

The problem is, this query is O(N) complex and it might take significant I/O time to execute. Even if you cache it heavily, cache misses would be slow.

**Let's see how we can leverage [materialize](https://vitess.io/docs/reference/vreplication/materialize/){:target="\_blank"} feature that comes with Vitess and build results of that table ahead of time.**

## Experiment

We'll assume the `commerce` schema has our `products` table, and the `storefront` schema is where we want stuff to be materialized.

```sql
-- create materialized table on storefront keyspace
CREATE TABLE `product_types_by_tenant` (
  `tenant_id` bigint(20) DEFAULT NULL,
  `product_type` varchar(255) DEFAULT NULL,
  UNIQUE KEY `index_tenant_id_and_product_type` (`tenant_id`,`product_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Creating a materialized view is as easy as:

```bash
$ vtctlclient Materialize '{"workflow": "product_types_by_tenant", "source_keyspace": "commerce", "target_keyspace": "storefront",
    "table_settings": [{"target_table": "product_types_by_tenant",
    "source_expression": "select tenant_id, product_type from products group by tenant_id, product_type"}],
    "cell": "zone1", "tablet_types": "REPLICA"}'

# to monitor
$ vtctlclient  Workflow storefront.product_types_by_tenant show
```

`SELECT tenant_id, product_type FROM products GROUP BY tenant_id, product_type` is our query that is passed as an argument to `Materialize`. It will get us the same result as `SELECT DISTINCT product_type` does for a single shop. Check [materialize docs](https://vitess.io/docs/reference/vreplication/materialize/){:target="\_blank"} to see how the rest of arguments are built.

If you're curious how the status of the stream looks like:

```json
{
  "Workflow": "product_types_by_tenant",
  "SourceLocation": {
    "Keyspace": "commerce",
    "Shards": [
      "-"
    ]
  },
  "TargetLocation": {
    "Keyspace": "storefront",
    "Shards": [
      "-"
    ]
  },
  "MaxVReplicationLag": 1,
  "ShardStatuses": {
    "-/zone1-0428408676": {
      "MasterReplicationStatuses": [
        {
          "Shard": "-",
          "Tablet": "zone1-0428408676",
          "ID": 18,
          "Bls": {
            "keyspace": "commerce",
            "shard": "-",
            "filter": {
              "rules": [
                {
                  "match": "product_types_by_tenant",
                  "filter": "select tenant_id, product_type from products group by tenant_id, product_type"
                }
              ]
            }
          },
          "Pos": "MySQL56/53df5a9f-a5d0-11eb-a395-ce273039402d:1-282,549e34c6-a5d0-11eb-b33a-6a94ed0715c9:1-771072",
          "StopPos": "",
          "State": "Running",
          "DBName": "vt_storefront",
          "TransactionTimestamp": 1620643932,
          "TimeUpdated": 1620643933,
          "Message": "",
          "CopyState": null
        }
      ],
      "TabletControls": null,
      "MasterIsServing": true
    }
  }
}
```


```bash
# query from source
$ mysql commerce -e 'SELECT DISTINCT product_type FROM products WHERE tenant_id = 1'

# query from materialized
$ mysql storefront -e 'SELECT product_type FROM product_types_by_tenant WHERE tenant_id = 1'
```

Results of these two statements become identical &ndash; the only difference is that the latter is a lot more efficient.

## Things to note

* **Schema changes.** You can manage do perform a schema change that would break your materialize stream. I applied `ALTER TABLE products ADD some_new_column VARCHAR(255)` just to see if it breaks and the stream stayed healthy. That means it should work fine for new columns added, but I still think it would break if you do anything to materilized columns.

* **Limited queries.** Unfortunately, the subset of `SELECT` you can do in the materialized query is limited. It only supports simple `WHERE` clauses and it doesn't support `JOINs`. Browse [replicator_plan_test.go](https://github.com/vitessio/vitess/blob/579bb705b7e39a0970f6c5b092ebc415e366cd60/go/vt/vttablet/tabletmanager/vreplication/replicator_plan_test.go){:target="\_blank"} to see what kind of queries are supported.

* **Performance.** There are concerns with VReplication's performance that might become a problem on large tables with heavy write throughput. Hopefully those will be addressed soon.
  
  * [https://github.com/vitessio/vitess/issues/7997](https://github.com/vitessio/vitess/issues/7997){:target="\_blank"}
  
  * [https://github.com/vitessio/vitess/issues/8056](https://github.com/vitessio/vitess/issues/8056){:target="\_blank"}

* **Failure modes**. If something breaks and you restart `VReplicationExec`, you're the one responsible to keep the table clean. There's nothing there that would verify that a half-copied table is correct.

I'm excited to see technologies like Vitess making complex stuff like replicating and denormalizing a subset of data so much easier, and I'm looking forward for more investments to come into the Vitess ecosystem.
