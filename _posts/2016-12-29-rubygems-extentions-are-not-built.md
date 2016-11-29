---
layout: post
title: Debugging Rubygems
date: 2016-11-29
comments: true
published: true
---

**TL;DR:** run `bundle install --force` to fix "extensions are not built" errors

This note describes the source of `Ignoring [GEM NAME] because its extensions are not built` errors you may eventually encounter when starting a Ruby process.

Example:

```
$ bin/rails server
Ignoring nokogiri-1.6.8.1 because its extensions are not built.  Try: gem pristine nokogiri --version 1.6.8.1
Ignoring websocket-driver-0.6.4 because its extensions are not built.  Try: gem pristine websocket-driver --version 0.6.4
Ignoring libxml-ruby-2.9.0 because its extensions are not built.  Try: gem pristine libxml-ruby --version 2.9.0
```

Clearly, there's something wrong with the installed gems.
You can find ton of StackOverflow questions about this error message, but none of the answers there are true. Let's try to find what's the problem here.

We can start by inspecting the code that produces the error.
Let's see where my Rubygems sources are located:

```
$ which gem
/Users/kir/.rubies/ruby-2.3.3/bin/gem
```

Ok, let's go to `/Users/kir/.rubies/ruby-2.3.3` and grep the directory for similar messages. I use [ag](https://github.com/ggreer/the_silver_searcher) to file contents in the directory.

```
$ cd /Users/kir/.rubies/ruby-2.3.3
$ ag -Q "extensions are not built"
lib/ruby/2.3.0/rubygems/basic_specification.rb
74:      warn "Ignoring #{full_name} because its extensions are not built.  " +
```

Bingo. Now we can check what's inside [rubygems/basic_specification.rb](https://github.com/rubygems/rubygems/blob/c9d8350/lib/rubygems/basic_specification.rb#L74) and see which line prints the error message.

It comes from the method called `contains_requirable_file?`. When `missing_extensions?` is `true`, Rubygems prints the error message. There are two interesting things for us here:

1) Looking to the method description, it sounds like `contains_requirable_file?` is a flag that says if the gem has any requirable files.

2) We should obviously check [`missing_extensions?` method source](https://github.com/rubygems/rubygems/blob/c9d8350/lib/rubygems/specification.rb#L2179
)

If we debug `missing_extensions?` method, we'll see that the line that leads to the error is `return false if File.exist? gem_build_complete_path`. What's inside that path and why it's is missing?

In my case, the value of `gem_build_complete_path` was `/path/to/rails/app/vendor/bundle/extensions/x86_64-darwin-16/2.3.0-static/nokogiri-1.6.8.1/gem.build_complete`. Obviously, that file didn't exist. But there was a very similar file that existed: `/path/to/rails/app/vendor/bundle/extensions/x86_64-darwin-15/2.3.0-static/nokogiri-1.6.8.1/gem.build_complete`. If you haven't noticed the difference, look at `x86_64-darwin-16` vs `x86_64-darwin-15`.

This is related to a recent macOS upgrade. I initially installed my gems on OS X El Capitan (`x86_64-darwin-15`) and now I'm running macOS Sierra (`x86_64-darwin-16`). The actual issue is that running `bundle install` again won't rebuild the gem for the new `x86_64-darwin-16` platform.

This is likely a Bundler [issue](https://github.com/bundler/bundler/issues/5210). Right now it won't rebuild missing extentions when the gem is already installed. I'm looking forward to fix this bug, but meanwhile we can use the `--force` flag that would make Bundler to rebuild the extensions. `bundle install --force` fixes all problems! 🎉 🎉 🎉

<hr/>

I wrote this debugging story not to point to exact Bundler/Rubygems bugs, but to demonstrate how you can debug annoying warnings.
Instead of searching StackOverflow and following misguided tips, it's much more fun to look into internals yourself.
