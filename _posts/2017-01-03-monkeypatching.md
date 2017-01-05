---
layout: post
title: "Safe monkeypatching"
date: 2017-01-03
comments: true
published: true
---

Ruby is the language of monkey patching. While it's theoretically possible to avoid monkey patching, I'm 99% sure that your app contains at least a few of them (especially of you use Rails).

Monkey patching is usually considered as an anti-pattern, but sometimes it can't be avoided.

The typical use case of monkey patching in a Rails app is a bug fix. If you're using Rails 5 and the bug you're hunting was only fixed in 5.1 which is not released yet, you'd have no other option than to copy-paste the fix and use a monkey patch.

But still, there are good and bad ways to add a monkey patch. This [Pull Request](https://github.com/rails/rails/pull/27437) introduces a configurable options for dumping a database. Before that patch, there was no way to configure dumping flags. Imagine that we're using an older Rails and we still want to pass a custom flag. We'd have to monkeypatch that class:

```ruby
# config/initializers/active_record_patches.rb
module ActiveRecordDbCommandPatch
  def run_cmd(cmd, args, action)
    # pass an extra flag to mysqldump
    if cmd == "mysqldump"
      args = args + ["—skip-add-drop-table"]
    end
    super(cmd, args, action)
  end
end
ActiveRecord::Tasks::MySQLDatabaseTasks.prepend(ActiveRecordDbCommandPatch)
```

Why this way to monkey patch is not the best? Because when we upgrade on a new Rails version that has a configurable option, we may forget to clean up and this patch will still live in the app. Even worse, imagine that `run_cmd` method in Rails was refactored and the patch will introduce a bug.

We can improve it by 1) checking that `run_cmd` is available and 2) that configurable option is not available yet in the current Rails version.

```ruby
# config/initializers/active_record_patches.rb
if ActiveRecord::Tasks::DatabaseTasks.respond_to?(:structure_dump_flags)
  raise "you're running the Rails version that no longer requires the patch"
end

module ActiveRecordDbCommandPatch
  def run_cmd(cmd, args, action)
    # pass an extra flag to mysqldump
    if cmd == "mysqldump"
      args = args + ["—skip-add-drop-table"]
    end
    super(cmd, args, action)
  end
end

# instance_method will raise with NameError is the method is not available
if ActiveRecord::Tasks::MySQLDatabaseTasks.instance_method(:run_cmd)
  ActiveRecord::Tasks::MySQLDatabaseTasks.prepend(ActiveRecordDbCommandPatch)
end
```

This way will help you to remove the patch as soon as you update Rails. There is also a way to use the Rails version as an indicator that the patch is no longer necessary:

```ruby
if Rails::VERSION::MAJOR > 4
  raise "you're running the Rails version that no longer requires the patch"
end
```

* * *

For a large Rails app, it may be impossible to avoid monkeypatches. The best we can do is to inject them carefully, providing a safe way for a patch to be removed when it's no longer necessary.

Happy monkeypaching!
