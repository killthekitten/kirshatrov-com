---
layout: post
title: "Inspecting ActiveRecord queries"
date: 2016-10-31
comments: true
published: true
---

Imagine a case when you define conditions for how an object performs the SQL query:

```ruby
if supports_multiple_insert?
  # use bulk INSERT
  execute "INSERT INTO posts (id, title) VALUES (1, 'abc') (2, 'foo')"
else
  # use single INSERT
  execute "INSERT INTO posts (id, title) VALUES (1, 'abc')"
  execute "INSERT INTO posts (id, title) VALUES (2, 'foo')"
end
```

How would you test this condition?
There's no other way than to subscribe to SQL queries and watch them.

Using `ActiveRecord` you can implement it with a subscriber:

```ruby
class InsertQueriesSubscriber
  attr_reader :events

  def initialize
    @events = []
  end

  def call(_, _, _, _, values)
    @events << values[:sql] if values[:sql] =~ /INSERT/
  end
end

def test_bulk_insert
  begin
    insert_subscriber = InsertQueriesSubscriber.new
    subscription = ActiveSupport::Notifications.subscribe("sql.active_record", insert_subscriber)

    # perform the operation

    assert_equal 1, insert_subscriber.events.size, "It takes one INSERT query to insert two fixtures"
  ensure
    ActiveSupport::Notifications.unsubscribe(subscription)
  end
end
```

`events` will accumulate all `INSERT` queries and you can assert it.
This is actually a real life case from my [commit in Rails](https://github.com/rails/rails/commit/02f4c15671ad9cf94a1f6270b86b5e250cfb7dde).

Another example of using subscribers is forbidding specific SQL queries.
In our case, we wanted to forbid queries that contain serialized instance of `ActionController::Parameters`:

```ruby
class ParamsInsertQuerySubscriber
  # implementation of AC::Parameters is different in Rails 5
  PATTERN = if Rails::VERSION::MAJOR >= 5
    "!ruby/object:ActionController::Parameters"
  else
    "!ruby/hash-with-ivars:ActionController::Parameters"
  end

  def call(_, _, _, _, values)
    sql = values[:sql]
    if sql.starts_with?("INSERT") && sql.include?(PATTERN)
      raise "not allowed to store serialized ActionController::Parameters: #{sql}"
    end
  end
end
```

When running the app in development or test mode, you may enable the subscriber:

```ruby
ActiveSupport::Notifications.subscribe('sql.active_record', ParamsInsertQuerySubscriber.new)
```

You can imagine other use cases of SQL notifications.
Please share your ideas in comments!
