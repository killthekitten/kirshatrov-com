---
layout: post
title: Rewriting code with Rubocop
date: 2016-12-18
comments: true
published: true
---

Many of you used [Rubocop](https://github.com/bbatsov/rubocop/) to enforce code style in your project.
But have you thought that it can be also used to rewrite the code?

Under the hood, Rubocop uses [parser](https://github.com/whitequark/parser/) library to convert Ruby code into syntax tree (AST).
Within Rubocop cop (rule), you can manipulate with nodes of the syntax tree in any way you like. This gives us the power to write code that rewrites another code.

In my case, we did a huge refactoring and the project was full of blocks like:

```ruby
if ProjectName.support_legacy?
  # old code
else
  # new code
end
```

We had hundreds of `ProjectName.support_legacy?` statements all over the project. Sometimes it was `if`, and sometimes `unless`:

```ruby
unless ProjectName.support_legacy?
  # do smth
end
```

At some point the refactoring was finished and it was time to get rid of all `if ProjectName.support_legacy?` branches.
I'm not a big fan of writing complex regular expressions and I decided to give Rubocop a try with rewriting my code automatically.

Rubocop design provides you a way to add your own rules, which are called "cops". Here is our cop that removes all `if` branches with the legacy code:

```ruby
module RuboCop
  module Cop
    module CustomCops
      class RewriteLegacyBranch < Cop
        # Constant required for Rubocop
        MSG = 'violation message'.freeze

        # triggered on any `if` statement in the code
        def on_if(node)
          ifst = node.child_nodes[0]
          # if this is what we're looking for, mark it as an offence
          if ifst.method_name == :support_legacy? && ifst.receiver.source == "ProjectName"
            add_offense(node, :expression)
          end
        end

        private

        def autocorrect(node)
          ->(corrector) do
            # for unless, completely remove the statement
            if is_unless?(node)
              drop_unless_block(corrector, node)
            else
              drop_if_block_and_leave_new_code(corrector, node)
            end
          end
        end

        def is_unless?(node)
          loc = node.loc
          loc.respond_to?(:keyword) && loc.keyword.is?('unless'.freeze)
        end

        def drop_if_block_and_leave_new_code(corrector, node)
          # drop the `if` and just leave the new code
          new_source = String.new
          if_content = node.child_nodes[1]
          if_content.source.each_line do |line|
            # for indentation
            if line =~ /^( +)/
              line = line[2..-1]
            end
            new_source << line
          end
          corrector.insert_before(node.source_range, new_source)
          corrector.remove(node.source_range)
        end

        def drop_unless_block(corrector, node)
          # indentation workarounds to not leave whitespaces after we remove the block of code
          indent_found = node.source_range.source_line =~ /^( +)/
          if indent_found
            whitespaces = $1.size
            r = node.source_range
            line_range = r.class.new(r.source_buffer, r.begin_pos - whitespaces, r.end_pos + 1)
            corrector.remove(line_range)
          else
            corrector.remove(node.source_range)
          end
        end
      end
    end
  end
end
```

It turned out that he Rubocop API is not so well documented. I had to dig around the code of existing cops to see examples.
You'll may need to do the same if you're looking into creating rules that are more complex than mine.

Now it's time to apply the cop to the code:

```
bundle exec rubocop --require /absolute/path/to/cop_we_wrote.rb --only CustomCops/RewriteLegacyBranch --autocorrect
```

We provide three arguments to rubocop:

1. Require the custom cop that we wrote (the path should be absolute)
2. Only apply the single cop (by default, Rubocop will also apply a list of default cops)
3. Autocorrect the violations with the rule defined in `autocorrect` method

I was extremely happy with the fact that Rubocop saved me a couple of hours of cleaning up the legacy code myself.
