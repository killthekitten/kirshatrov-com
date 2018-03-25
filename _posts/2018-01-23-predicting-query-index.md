---
layout: post
title: Predicting database index hits
date: 2018-01-23
comments: true
published: true
---

In a large application, it’s fairly easy to introduce code that produces poor or unoptimized SQL queries.
As a developer, nothing stops you from writing this kind of a background job:

```ruby
class MyJob
  def perform(params)
    products = Product.where(active: true, created_at: 1.month.ago..1.week.ago, user_id: params[:user_id])
    products.find_each do |product|
      # do something with the product
    end
  end
end
```

Only after the code goes through review and CI pipeline, when it’s merged and deployed, you’ll find out that the SQL query that the relation produces doesn’t hit any index - or hits one that is inefficient. The query would time out and the job would crash with an exception.

Some cases could be caught by peer code review but humans are not perfect in predicting query efficiency. This is better done by machines.

You could use `EXPLAIN` to see what indexes the query hits and what’s the cost of the query, but results of `EXPLAIN` depend of the actual dataset and may be completely different in production and local environments. That makes it impossible to check queries using `EXPLAIN` as a part of CI, without giving it access to the production dataset.

Let’s try a manual lookup of indexes for a given table by running `SHOW INDEX FROM products`.
With a simple Ruby script we can compile a list of indexes and columns that they cover:

```ruby
require 'bundler/setup'
require 'mysql2'

client = Mysql2::Client.new(host: "localhost", username: "root", database: "demo")
res = client.query "SHOW INDEX FROM products"

indexes = {}

res.each do |row|
  record = indexes[row["Key_name"]] ||= {}
  record[:columns] ||= []
  record[:columns][row["Seq_in_index"] - 1] = row["Column_name"]
end

puts indexes.inspect
```

Good news: ActiveRecord already provides an API to lookup indexes!

```ruby
ActiveRecord::Base.connection.indexes(:product)
```

It looks like we could take columns from `WHERE` clause and match them with the columns covered by indexes. **That way, we could build a dumb predictor of SQL query efficiency.**

There’s a complication of `ORDER BY` that also affects a chosen index but we’ll simplify it for now.

If we somehow implemented it, we could reduce the rate of human errors and prevent developers from shipping code that won’t be able to efficiently run in production. **In a large organization, that could save a few human hours per day.**

## Parsing queries

As we found, getting a list of indexes and columns that they cover is easy, especially with ActiveRecord. Now let’s see if we can identify columns mentioned in the `WHERE` clause.

With ActiveRecord, we could use `where_values_hash`.

```ruby
Product.where(user_id: 42).where_values_hash
=> {"user_id"=>42}
```

But as we’ll learn later, it only returns values of exact matches and it doesn’t work for plain predicates and ranges:

```ruby
Product.where("user_id IS NOT NULL").where(created_at: 1.month.ago..1.week.ago).where_values_hash
=> {}
```

If we look how `where_values_hash` is [implemented](https://github.com/rails/rails/blob/412db710dfa6ed84654068576b1841966d7f89b2/activerecord/lib/active_record/relation/where_clause.rb#L49){:target="_blank"}, we’ll see that it reads Arel predicates. Let’s try hooking into Arel:


```ruby
Product
  .where(active: true)
  .where("user_id IS NOT NULL")
  .where(created_at: 1.month.ago..1.week.ago)
  .where_clause
  .send(:predicates)
  .map(&:class)
=> [Arel::Nodes::Equality, String, Arel::Nodes::Between]
```

We could work with `Arel::Nodes::Between` and `Arel::Nodes::Equality`, but we'd still need to extract the column from `"user_id IS NOT NULL"` which is a string.

If we look broader, we’ll find something called [libgda](https://github.com/GNOME/libgda){:target="_blank"} that has an AST parser of SQL queries. There’s even a [Ruby binding](https://github.com/tenderlove/gda){:target="_blank"} for it. Let's play with it:

```ruby
class Visitor < GDA::Visitors::Visitor
  def visit_GDA_Nodes_Expr node
    puts "#{node.class}, #{node.value}, #{node.value.class}"
    super
  end
end

query = "SELECT id FROM products " \
  "WHERE user_id IS NOT NULL " \
  "AND active = 1 " \
  "AND created_at BETWEEN '2017-12-20 20:57:57' AND '2018-01-19 20:57:57'"

parser = GDA::SQL::Parser.new
result = parser.parse(query)
Visitor.new.accept(result.ast)
```

Which gives the following output:

```
GDA::Nodes::Expr, id, String
GDA::Nodes::Expr, products, String
GDA::Nodes::Expr, NULL, String
GDA::Nodes::Expr, NULL, String
GDA::Nodes::Expr, user_id, String
GDA::Nodes::Expr, NULL, String
GDA::Nodes::Expr, active, String
GDA::Nodes::Expr, 1, String
GDA::Nodes::Expr, NULL, String
GDA::Nodes::Expr, created_at, String
GDA::Nodes::Expr, '2017-12-20 20:57:57', String
GDA::Nodes::Expr, '2018-01-19 20:57:57', String
```

You can see AST nodes that GDA extracted from the query. There are columns and values, but all of them are of `GDA::Nodes::Expr` type. It gets tricky to separate what is a column and what is a value. Either I missed something about it, either GDA is too low level for our purpose.

## Conclusion

To continue experiments, I'll probably use Arel and manually parse `user_id IS NOT NULL` predicates. That may give me "good enough" results as I'll be able to run it against a large codebase to see how many false positive it will identify.

Stay tuned to learn about results!
