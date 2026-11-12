use strict;
use warnings;
use DynaLoader;

my ($library, $action, $pid) = @ARGV;
die "Invalid media command\n" unless defined($pid) && $pid =~ /^\d+$/
    && $action =~ /^(pause|resume|status)$/;
$ENV{SITUATE_MEDIA_ACTION} = $action;
$ENV{SITUATE_MEDIA_PID} = $pid;
my $handle = DynaLoader::dl_load_file($library, 0) or die "Media helper unavailable\n";
my $symbol = DynaLoader::dl_find_symbol($handle, "situate_media_command")
    or die "Media entry point unavailable\n";
DynaLoader::dl_install_xsub("main::execute", $symbol);
execute();
