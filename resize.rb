Dir['assets/photography/**/*'].each do |path|
  next if File.directory?(path)
  next if path.include?("_pix.jpg")

  dir = File.dirname(path)
  base = File.basename(path, ".*")

  pix_path = "#{dir}/#{base}_pix.jpg"

  # unless File.exist?(pix_path)
    cmd = "convert -scale 10% -scale 300% #{path} #{pix_path}"
    `#{cmd}`
  # end
end
