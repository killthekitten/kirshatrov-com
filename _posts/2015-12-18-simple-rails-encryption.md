---
layout: post
title: Simple encryption of ActiveRecord fields
date: 2015-12-18
comments: true
published: true
---

For past week, I have been working on encryption solution for a Rails app.
The requirement was to encrypt chosen fields like `ssn` of an ActiveRecord model.

I've research a variety of solutions, including [attr_encrypted](https://github.com/attr-encrypted/attr_encrypted)
and [encryptor](https://github.com/attr-encrypted/encryptor) gems.

I want to show a simple way of encryption that combines [ActiveRecord::Base.serialize](http://api.rubyonrails.org/classes/ActiveRecord/AttributeMethods/Serialization/ClassMethods.html#method-i-serialize)
and `OpenSSL::Cipher`, which comes with the Ruby stdlib.

Few things to bear in mind:

* this kind of encryption helps only in case when your database is stolen
* if hacker gets access to Rails console or `ENV['ENCRYPTION_KEY']`, you're hacked
* you may want to use [IV](http://ruby-doc.org/stdlib-2.2.0/libdoc/openssl/rdoc/OpenSSL/Cipher.html#method-i-iv-3D) and [salt](http://ruby-doc.org/stdlib-2.2.0/libdoc/openssl/rdoc/OpenSSL/Cipher.html#method-i-pkcs5_keyivgen) for sensitive data
* by using Marshal, our encrypted field can store instance of any class (Date, Time, whatever!)


{% highlight ruby %}
# lib/crypt.rb
module Crypt
  class << self
    def encrypt(value)
      crypt(:encrypt, value)
    end

    def decrypt(value)
      crypt(:decrypt, value)
    end

    def encryption_key
      ENV.fetch('ENCRYPTION_KEY')
    end

    ALGO = 'aes-256-cbc'.freeze
    def crypt(cipher_method, value)
      cipher = OpenSSL::Cipher::Cipher.new(ALGO)
      cipher.send(cipher_method)
      cipher.pkcs5_keyivgen(encryption_key)
      result = cipher.update(value)
      result << cipher.final
    end
  end
end

# lib/encrypted_coder.rb
# custom coder for Rails serialized attribute
# more examples: https://github.com/rails/rails/tree/4-2-stable/activerecord/lib/active_record/coders
# encrypted value has to be stored as base64 because it's not UTF-safe
class EncryptedCoder
  def load(value)
    return if value.nil?

    Marshal.load(
      Crypt.decrypt(
        Base64.decode64(value)))
  end

  def dump(value)
    Base64.encode64(
      Crypt.encrypt(
        Marshal.dump(value)))
  end
end

# app/models/wow_such_secure_model.rb
class WowSuchSecureModel < ActiveRecord::Base
  serialize :ssn, EncryptedCoder.new
end
{% endhighlight %}

Done! You can use `EncryptedCoder` in any model.

A quick demo:

{% highlight ruby %}
pry(main)> model = WowSuchSecureModel.create(ssn: "11-22-333")
   (0.2ms)  BEGIN
   SQL (13.2ms)  INSERT INTO "table" ("ssn", "created_at", "updated_at")
   VALUES ($1, $2, $3) RETURNING "id"
   [["ssn", "S9CTpTxsuG1mFExrFzyy1XD1qtxpiTKGOiopvFhuuwY=\n"], ["created_at", "2015-12-18 21:52:24.425346"], ["updated_at", "2015-12-18 21:52:24.425346"]]
   (7.5ms)  COMMIT
=> #<WowSuchSecureModel:0x007f803a19f4f8
 id: 4,
 ssn: "11-22-333",
 created_at: Fri, 18 Dec 2015 21:52:24 UTC +00:00,
 updated_at: Fri, 18 Dec 2015 21:52:24 UTC +00:00>
pry(main)> model.ssn
=> "11-22-333"
pry(main)> WowSuchSecureModel.last.ssn
=> "11-22-333"
pry(main)> WowSuchSecureModel.last.ssn_before_type_cast
=> "S9CTpTxsuG1mFExrFzyy1XD1qtxpiTKGOiopvFhuuwY=\n"
{% endhighlight %}
