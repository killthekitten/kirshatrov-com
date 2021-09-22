Dir['assets/photography/**/*'].each do |path|
  next if File.directory?(path)

  dir = File.dirname(path)
  base = File.basename(path, ".*")

  cmd = "convert -scale 10% -scale 500% #{path} #{dir}/#{base}_pix.jpg"
  `#{cmd}`
end
