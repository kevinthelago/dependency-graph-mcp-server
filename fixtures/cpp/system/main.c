#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int greet(const char *name) {
    char *buf = malloc(strlen(name) + 8);
    if (!buf) return -1;
    sprintf(buf, "Hello, %s!", name);
    puts(buf);
    free(buf);
    return 0;
}
