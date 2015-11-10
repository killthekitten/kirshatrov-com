---
layout: post
title: Using Kaminari to paginate non-ActiveRecord query
date: 2015-11-08
comments: true
published: true
---

While optimizing database performance in a Rails app, sometimes we stop using ActiveRecord in the critical parts.
Avoiding ActiveRecord models gives us the freedom of writing complex SQL queries and working with them as with plain objects.
But it also becomes tricky when you want to pass them to other Rails components - like forms and pagination.

In my case, I had a plain SQL query that I passed directly to PostgreSQL using the [`pg` gem](http://deveiate.org/code/pg/).
Later when I passed the query results to a Rails view, I realized that I also need to paginate results when presenting them to a user.

[Kaminari](https://github.com/amatsuda/kaminari) (which I am using) is a de-facto pagination solution for Rails apps.
Then how to paginate a custom non-ActiveRecord query with Kaminari?

Beside of ActiveRecord integration, Kaminari also provides API for paginating plain arrays:

{% highlight ruby %}
# controller
rows = PG.connect(...).exec("SELECT complex_query FROM big_users_table JOIN ... GROUP BY ...").to_a
@users = Kaminari.paginate_array(rows)

# view
<%= paginate @users %>
{% endhighlight %}

Imagine fetching 100k records from the table, loading them into Ruby memory and then slicing only 10 of them
to render the first page. Sounds horrible, right?

To write a better solution, let's review how Kaminari works with ActiveRecord:

{% highlight ruby %}
# model
class User < ActiveRecord::Base;end

# controller
@users = User.all

# view
<%= paginate @users %>
{% endhighlight %}

Technically, `@users` is an instance of `ActiveRecord::Relation`.
The `paginate` [helper](https://github.com/amatsuda/kaminari/blob/master/lib/kaminari/helpers/action_view_extension.rb#L17)
that comes with Kaminari accepts `ActiveRecord::Relation`, which should respond to these 3 methods:

* `current_page` - returns current page number
* `total_pages` - returns total number of pages
* `all` - returns an array of rows for the current page

What if we write *our own relation object* that would behave exactly like `ActiveRecord::Relation` and then simply pass it to `paginate`?

Here is the final code of the Relation class:

<script src="https://gist.github.com/kirs/5a098654f1c1205ddbaa.js"></script>

How do we use it with a view and a controller?

{% highlight ruby %}
# controller
@collection = MyRelation.new(params[:page] || 1)

# view
<%= paginate @collection %>
{% endhighlight %}

It works: `params[:page]` is passed to the query and Kaminari renders pagination for it.

<img src="{{ site.url }}/assets/post-images/kaminari-query.gif" />

<hr/>

I digged into writing my own relation object mostly because of the interest.
In most of the cases, the problem can be solved by creating a PostgreSQL view:

{% highlight sql %}
CREATE VIEW my_complex_view AS (SELECT ...);
{% endhighlight %}

And using this view from an ActiveRecord model:

{% highlight ruby %}
# model
class MyComplexQuery < ActiveRecord::Base
  self.table_name = "my_complex_view"
end

# controller
@collection = MyComplexQuery.all

# view
<%= paginate @collection %>
{% endhighlight %}

The result will be the same.

It's up to you to use a view or to write a relation object, through the first option may not be possible
for some kind of queries.
