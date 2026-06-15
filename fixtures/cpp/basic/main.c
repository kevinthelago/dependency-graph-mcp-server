#include "util.h"
#include <stdio.h>

int main(void) {
    Point p = {1, 2};
    printf("add: %d\n", add(p.x, p.y));
    printf("max: %d\n", MAX(p.x, p.y));
    return 0;
}
