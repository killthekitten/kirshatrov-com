---
layout: post
title: "Five ways to write a flaky test"
date: 2016-10-21
comments: true
published: true
---

Test flakiness is a part of technical debt that ruins your everyday work.
It prevents new code from being shipped just because CI is red, and you have to go and restart the build.
It creates frustration from the fact that your code may be broken, when in fact it's not.

Having [50k tests and hundreds of developers](https://jobs.lever.co/shopify?lever-via=eV7L5-Yack)
makes the chance of introducing a flaky test even higher.

Some cases that I demonstrate are related to test order and some are not.
What is the test order and how it's related? The best practice is to run your tests in random order,
to make sure that a test is not coupled with another test, and the order in which they run does not matter.

I will use MiniTest syntax in examples, but RSpec vs MiniTest doesn't really matter here because all these issues
are framework agnostic.

## 1. Random factories

```ruby
# assuming the email field has unique constraint
10.times do
  Customer.create!(email: Faker::Internet.safe_email)
end
```

Do you see anything suspicious here?
In most of the times, it will pass. But sometimes [Faker](https://github.com/stympy/faker) may return a random email
that has already been used, and your test will crash with uniqueness constraint error.

The right way:

```ruby
10.times do |n|
  Customer.create!(email: Faker::Internet.safe_email(n.to_s))
end
```

The argument tells Faker to return n-th email, instead of a random one.

## 2. Database records order

```ruby
assert_equal([1, 2, 3], @products.pluck(:quantity))
```

While this test may usually pass, the SELECT query without ORDER instruction doesn't guarantee consistent order of records.
To avoid random failures, you should explicitly specify the order:

```ruby
assert_equal([1, 2, 3], @products.pluck(:quantity).sort)
# or
assert_equal([1, 2, 3], @products.order(:quantity).pluck(:quantity))
```

## 3. Mutating the global environment

```ruby
BulkEditor.register(User) do
  attributes(:email, :password)
end
assert_equal [:email, :password], BulkEditor.attributes_for(@user)
```

In my case, `BulkEditor` used a global variable to store the registered models list.
As a result, after running the test the registry gets dirty.
This may affect other tests that will run after it (make them order dependent).

Solution:

```ruby
setup to
  BulkEditor.register(User) do
    attributes(:email, :password)
  end
end

teardown do
  BulkEditor.unregister(User)
end
```

I have another real life example of mutating the state:

```ruby
test "something" do
  SomeGem::VERSION = '9999.99.11'
  assert_not @provider.supported?
end
```

Any test that will run after this one will get broken value of `SomeGem::VERSION`.
It will also lead to a language-level warning: `warning: already initialized constant SomeGem::VERSION`

Solution:

```ruby
test "something" do
  # only the block will get modified value of the constant
  stub_constant(SomeGem, :VERSION, '9999.99.99') do
    assert_not @provider.supported?
  end
end
```

## 4. Time-sensitive tests

```ruby
post = publish_delayed_post
assert_equal 1.hour.from_now, post.published_at
```

Normally, the test would pass. But sometimes the post publishing will take a little longer than a millisecond,
and `published_at` will take a little more than `1.hour.from_now`.

There's a special helper `assert_in_delta` exactly for this case:


```ruby
post = publish_delayed_post
assert_in_delta 1.hour.from_now, post.published_at, 1.second
```

As an alternative, you can also freeze the time with libraries like [Timecop](https://github.com/travisjeffery/timecop).

## 5. Require-dependent tests

We had two kinds of test classes: one allowed remote HTTP calls and one not. Here is how it looked like:

```ruby
# test/unit/remote_api_test.rb
require 'remote_test_helper'

class RemoteServiceTest < ActiveSupport::TestCase
  test "something" do
    # ...
  end
end

# test/unit/simple_test.rb
require 'test_helper'

class SimpleTest < ActiveSupport::TestCase
  test "something" do
    # ...
  end
end
```

A number of tests used `remote_test_helper` that allowed the test case to make external HTTP calls.
As you may guess, it perfectly worked when you run a single test. But when running all tests on CI, depending on the test order,
it could happen that every test that was executed after the remote one was allowed to make external calls 😱

You should always keep in mind that `require` is global and it's going to mutate the global state.

A better solution would be to use a macro that modifies only the context of specific test:

```ruby
# test/unit/remote_api_test.rb
require 'test_helper'

class RemoteServiceTest < ActiveSupport::TestCase
  allow_remote_calls!

  test "something" do
    # ...
  end
end

# test/unit/simple_test.rb
require 'test_helper'

class SimpleTest < ActiveSupport::TestCase
  test "something" do
    # ...
  end
end
```

# Summary

Fixing a flaky tests is usually hard and it deserves a separate blog post, so I would suggest
you to not even introduce one. If you're intested, you can use one of links below to read more about flaky tests.

# Further reading

* [Using Rspec bisect to catch order dependent tests](https://thoughtbot.com/upcase/videos/rspec-bisect)
* [How to Deal With and Eliminate Flaky Tests](https://semaphoreci.com/community/tutorials/how-to-deal-with-and-eliminate-flaky-tests)
* [Even Ruby core has flaky tests](https://bugs.ruby-lang.org/issues/12776)
