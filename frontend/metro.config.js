const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add support for Supabase packages
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@supabase/postgrest-js': require.resolve('@supabase/postgrest-js'),
  '@supabase/realtime-js': require.resolve('@supabase/realtime-js'),
  '@supabase/storage-js': require.resolve('@supabase/storage-js'),
};

// Handle all file extensions
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs', 'mjs'];

module.exports = config;