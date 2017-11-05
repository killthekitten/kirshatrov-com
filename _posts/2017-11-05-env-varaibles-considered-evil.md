---
layout: post
title: Environment variables considered evil
date: 2017-11-05
comments: true
published: true
---

For the past few years I noticed that it became more common among developers to use environment (ENV) variables as a way to control a command line tool. In this post I'm going to expand some of the use cases and demonstrate why in some of them ENV variables may be considered evil, and why using classic command line arguments may be a better approach.

***

In the Ruby world, it's common to define tasks with something called [Rake](https://en.wikipedia.org/wiki/Rake_(software)){:target="_blank"}. Rake is a build tool and a DSL for task management. Historically, Rake tasks caused many developers to use ENV variables. This comes from the [lack of arguments support](https://robots.thoughtbot.com/how-to-use-arguments-in-a-rake-task){:target="_blank"} in Rake. Developers are left with ENV variables as the only way to control the flow. Consider a task from e-commerce application that seeds products for a specific shop:

```ruby
# products.rake
namespace :products do
  task :generate do
    shop = Shop.find(ENV['SHOP_ID'])
    10.times do
      shop.products.create(...)
    end
  end
end

# SHOP_ID=1 rake products:generate
```

If developer forgot to add a check for `SHOP_ID` being present, you'll end up with an exception when `SHOP_ID` is empty. Developer would need to re-run the task after an exception when they learn that there's a required ENV variable.

Imagine that the task grows over time and now it takes a dozen arguments. There's no way to list all accepted ENV variables. There's no way to run it with a `--help` flag to see what each variable is responsible for. Developer could read the source and see what each option is made for, but what if the logic is spread across multiple files? Good luck with searching the codebase for `ENV` keyword and reading the code.

When you are building a command line tool, it's usually for the best to stay away from Rake tasks and stick with a plain Ruby script instead. That's when [OptionParser](http://ruby-doc.org/stdlib-2.4.2/libdoc/optparse/rdoc/OptionParser.html){:target="_blank"} comes for the rescue. It allows you to specify an option name and a type for each argument. It will also take care of supporting `--help` flag that lists all available options and description.

```ruby
require 'optparse'

options = {}
OptionParser.new do |opts|
  opts.banner = "Usage: bin/generate_products [options]"

  opts.on("-s", "--shop-id VALUE", "Shop ID") do |id|
    options[:shop_id] = id
  end

  opts.on("-v", "--[no-]verbose", "Run verbosely") do |v|
    options[:verbose] = v
  end
end.parse!

p options
shop = Shop.find(options[:shop_id])
10.times do
  shop.products.create(...)
end
```

```
$ bin/generate_products --help
Usage: bin/generate_products [options]
    -s, --shop-id VALUE              Shop ID
    -v, --[no-]verbose               Run verbosely
```

Since [Capistrano](http://capistranorb.com/){:target="_blank"} is based on Rake it inherits its poor support of arguments. When it comes to customizing tasks, it's tempting for developers to use ENV variables:

<img width="775" alt="screen shot 2017-10-07 at 11 59 19" src="https://user-images.githubusercontent.com/522155/31309615-fa5cb4f4-ab56-11e7-9962-447dc19d611f.png">

Now we know why it might be not the best idea. The number of variables will grow and there would be no way to list them other than digging documentation and sources. It's opaque that kind of input each of the variables accepts.

Now let's review a case where environment variables can be helpful.

## Global configuration

[Semian](https://github.com/Shopify/semian) is a resiliency toolkit for Ruby. It injects itself into MySQL and Redis clients to fail fast in case of incidents. It's used heavily at Shopify to make our apps resilient to outages.

Semian is always there sitting in front of database adapters, doesn't matter if you run the Rails app as a web server (by starting Unicorn) or as a job worker (by starting Sidekiq or Resque). What would be the way to tweak or disable Semian?

We can't do it with `OptionParser` as we did in the previous case because web server (Unicorn) and job worker (Sidekiq) each take their own arguments. This is where an environment variable like [SEMIAN_SEMAPHORES_DISABLED](https://github.com/Shopify/semian/blob/4218ea541c79f2402ae693e015a8a74bed4eb750/lib/semian/platform.rb#L14){:target="_blank"} is extremely helpful. Since this option is something that is only used by operations engineers in extreme cases, the lack of discovery of the option (the one you get with `--help` flag) is acceptable.

## Combining arguments and ENV variables

[kubernetes-deploy](https://github.com/Shopify/kubernetes-deploy){:target="_blank"} is a tool to watch deployment progress in Kubernetes. It takes few arguments:

```
$ kubernetes-deploy --help
$ kubernetes-deploy namespace context --template-dir config/k8s --no-prune
```

At the same time, it [relies](https://github.com/Shopify/kubernetes-deploy#usage){:target="_blank"} on `KUBECONFIG` variable that is usually set in your shell. But if your want to deploy with a specific KUBECONFIG, nothing stops you from running the tool with ENV variable:

```
$ KUBECONFIG=./mykubeconfig kubernetes-deploy namespace context --template-dir config/k8s --no-prune
```

Here is the rule that I often use when discussing UX of a command line tool: you must have a good reason to prefer ENV variable over command line arguments. Global Kubernetes config of a flag to completely disable Semian are such cases.

## Summary

Introducing control with ENV variable may be tempting, but first we should think about end users of the tool and the discoverability of the arguments. With ENV variables there's no way to list allowed options and their values, and there's nothing like `--help` flag that shows the usage.

For user-facing command line tools you should always provide help about usage and expected values for each argument. `OptionParser` is a great tool for those scripts that comes in with the language standard library.

For cases like global configuration sometimes it's not possible to control behaviour with command line flags. Those are use cases when ENV variables may help.

Keep it mind that ENV variables also bring the pattern of global variables which is something that any language recommends to avoid. ENV variables are also harder to test, and nothing prevents shitty code from mutating then in the runtime (`ENV['MY_FRAGILE_SETTING'] = "new_value"`).

It's important to know that some ENV variables like [$HOST](https://github.com/rails/rails/issues/29516){:target="_blank"} are reserved by the system.

All of these reason make me to think twice before introducing a global ENV variable. I hope this post was convincing enough.
