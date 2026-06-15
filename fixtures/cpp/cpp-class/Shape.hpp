#pragma once

#include <string>

namespace geometry {

class Shape {
public:
    explicit Shape(std::string name);
    virtual ~Shape() = default;

    virtual double area() const = 0;
    virtual double perimeter() const = 0;
    const std::string& name() const;

private:
    std::string name_;
};

class Circle : public Shape {
public:
    explicit Circle(double radius);
    double area() const override;
    double perimeter() const override;

private:
    double radius_;
};

} // namespace geometry
