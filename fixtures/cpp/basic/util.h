#ifndef UTIL_H
#define UTIL_H

int add(int a, int b);
int multiply(int a, int b);

typedef struct {
    int x;
    int y;
} Point;

#define MAX(a, b) ((a) > (b) ? (a) : (b))

#endif /* UTIL_H */
