cmake_minimum_required(VERSION 3.22.1)
project(workspace_publication LANGUAGES C)

add_library(workspace_publication SHARED workspace_publication.c)
set_target_properties(workspace_publication PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED YES)
target_compile_options(workspace_publication PRIVATE -Wall -Wextra -Werror)
