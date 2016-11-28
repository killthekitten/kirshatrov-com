---
layout: post
title: "Developing Rails on JRuby"
date: 2016-11-28
comments: true
published: true
---

For the last couple of weeks, I've got my hands dirty with JRuby.
With the main goal of making Rails test suite green(er) on JRuby I used it as an opportunity to dive into JRuby internals.

```
$ chruby jruby-9.1.6.0
$ cd ~/Projects/opensource/rails
$ jruby -S bundle install
$ cd activemodel

# running all activemodel tests
$ jruby -S bundle exec rake test

# running single test file
$ jruby -S bundle exec ruby -Itest test/cases/failing_test.rb

# running single test case
$ jruby -S bundle exec ruby -Itest test/cases/failing_test.rb -n test_spefici_failing
```

The process of developing Rails on JRuby was pretty easy, until I got into a situation when I fixed a couple on bugs in JRuby master and I wanted to run tests against my own build of JRuby.

Assuming my build of JRuby master is located in `~/Projects/opensource/jruby/bin/jruby`

```
$ cd ~/Projects/opensource/rails/activemodel
$ ~/Projects/opensource/jruby/bin/jruby --dev -S bundle exec ruby -v
ruby 2.0.0p648 (2015-12-16 revision 53162) [universal.x86_64-darwin16]
```

WTF? It looks like `bundle exec` doesn't respect the JRuby environment.
At the same time, we should remember that `bundle exec` is just a wrapper around `require 'bundler/setup`.

The following command successfully runs `decimal_test.rb` from ActiveModel:

```
$ ~/Projects/opensource/jruby/bin/jruby --dev -rbundler/setup -Itest test/cases/type/decimal_test.rb
```

Talking about JRuby internals, I was amazed with how readable they are when compared with MRI C sources.
So faw I managed to fix [two issues](https://github.com/jruby/jruby/pulls?utf8=%E2%9C%93&q=is%3Apr%20author%3Akirs%20) and all of them required to write a bit of Java code.
That felt quite easy. I don't imagine how much time I would spend if I had to do the same with C code in MRI.
